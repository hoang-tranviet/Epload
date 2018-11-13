/*
 * this software is licensed under the mit license: http://www.opensource.org/licenses/mit
 *
 * copyright (c) 2014 university of washington
 *
 * permission is hereby granted, free of charge, to any person obtaining a copy of 
 * this software and associated documentation files (the "software"), to deal in the 
 * software without restriction, including without limitation the rights to use, copy, 
 * modify, merge, publish, distribute, sublicense, and/or sell copies of the software, 
 * and to permit persons to whom the software is furnished to do so, subject to the 
 * following conditions:
 *
 * the above copyright notice and this permission notice shall be included in all copies 
 * or substantial portions of the software.
 *
 * the software is provided "as is", without warranty of any kind, express or implied, 
 * including but not limited to the warranties of merchantability, fitness for a particular 
 * purpose and noninfringement. in no event shall the authors or copyright holders be liable 
 * for any claim, damages or other liability, whether in an action of contract, tort or 
 * otherwise, arising from, out of or in connection with the software or the use or other 
 * dealings in the software.
 */

var spdy = require('spdy'), 
    util = require('util'),
    stream = require('stream'),
    spdy_client = require('../spdy_client');

/*
 * function create()
 * Returns an instance of Session
 */
exports.create = function create(session, request) {
  return new Stream(session, request);
}

/*
 * Constructor
 * Returns a SPDY stream
 */
function Stream(session, request) {
  stream.Duplex.call(this);
  var self = this;

  this.options = request.options;
  this.log_level = request.options.log;
  this.callback = request.callback;
  this.id = -1;
  this.priority = request.options.priority;
  this.session = session;
  this.socket = session.socket;
  this._framer = session.framer;

  this._frame_reply = null;
  this._frames_data = [];
  this._data = '';
  this._content_length = 0;
  this._content_length_rcvd = 0;

  this.pendingData = [];
  this.isPendingData = true;
  this.isPendingRequest = true;
  this.contentLength = 0;

  this.ondata = this.onend = null;

  this._rstCode = 1;
  this._destroyed = false;

  this.closedBy = {
    client : false,
    server : false
  };

  // Lock
  this._locked = false;
  this._lockBuffer = [];

  this.pushes = [];

  this._sinkSize = session.sinkSize;
  this._initialSinkSize = session.sinkSize;

  this._sinkBuffer = [];

  this.on('socket', function(s) {
    this.socket = s;
  });

  this.on('flushdata', this.flushPendingData);

  this.on('error', function(e) {
    spdy_client.utils.log(self.log_level, e);
  })

  return self;
}
util.inherits(Stream, stream.Duplex);

/*
 * function send()
 * Send SYN_STREAM frame
 */
Stream.prototype.send = function send() {
  var self = this;
  stream.isPendingRequest = false;
  var dict = spdy_client.utils.headersToDict(self.options.headers, function(headers) {
    headers[':host'] = self.options.host;
    headers[':method'] = self.options.method;
    headers[':path'] = self.options.path;
    headers[':scheme'] = (self.options.plain) ? 'http' : 'https';
    headers[':url'] = self.options.url;
    headers[':port'] = self.options.port;
    headers[':version'] = self.session.options.http_version;
    headers[':user-agent'] = self.session.options.user_agent;
    headers[':accept'] = self.session.options.accept;
    headers[':accept-encoding'] = self.session.options.accept_encoding;
  });

  spdy_client.utils.log(self.log_level, "--- create frame SYN_STREAM");

  // Create a new stream, reuse framer for that
  self.session._lock(function() {
    self.session.streamId += 2;

    // Note that we can't reuse _synFrame because it is used only for server side SYN_STREAM
    self.session.framer.deflate(dict, function (err, chunks, size) {
      var offset = 18,
          total = 10 + size,
          frame = new Buffer(offset + size),
          assoc = null;

      frame.writeUInt16BE(0x8003, 0, true); // Control + Version
      frame.writeUInt16BE(1, 2, true); // type
      frame.writeUInt32BE((total & 0x00ffffff) | (1 << 24) & 0xff000000, 4, true); // Set flag FLAG_FIN 0x01
      frame.writeUInt32BE(self.session.streamId & 0x7fffffff, 8, true); // Stream-ID
      frame.writeUInt32BE(assoc & 0x7fffffff, 12, true); // Assoc Stream-ID
      frame.writeUInt8((self.options.priority & 0x7) << 5, 16, true); // Priority

      for (var i = 0; i < chunks.length; i++) {
        chunks[i].copy(frame, offset);
        offset += chunks[i].length;
      }

      spdy_client.utils.log(self.log_level, "--- requesting SYN_STREAM ", self.session.streamId, frame);

      // store the request with the frame id
      self.session.streams[self.session.streamId] = self;
      self.session.streamsCount++;
      self.id = self.session.streamId;

      if (self.session.streamsCount > self.session.maxStreams) {
        // send RST_STREAM frame with error REFUSED_STREAM
        self._rstCode = 3;
        self.destroy(null);
      } else {
        // write frame to socket
        self.session.write(frame);
        self.session.emit('socket', self.session.socket);
      }
      self.session._unlock();
    });
  });
};

/*
 * function onReceiveReply()
 * Handle received SYN_REPLY
 */
Stream.prototype.onReceiveReply = function onReceiveReply(frame) {
  this._frame_reply = frame;
  this._content_length = parseInt(frame.headers['content-length']);

  this.callback(this);
  this.emit('reply', frame.headers, frame.priority);
  this.emit('data', frame.data, frame.fin);
}

/*
 * function onReceiveData()
 * Handle received data frames
 */
Stream.prototype.onReceiveData = function onReceiveData(frame) {
  var self = this;

  if (this.closedBy.server) {
    // Send RST_STREAM frame with error STREAM_ALREADY_CLOSED
    self.session.write(self._framer.rstFrame(frame.id, 9));
    return;
  }

  if (!this._frame_reply) {
    // Send RST_STREAM frame with error INVALID_STREAM
    self.session.write(self._framer.rstFrame(frame.id, 2));
    return;
  }

  this._frames_data.push(frame);
  this._content_length_rcvd += frame.data.length;
  if (frame.fin) {
    spdy_client.utils.log(self.log_level, "--- done w/ responding ", frame.id);
  }

  this.emit('data', frame.data, frame.fin);
}

/*
 * function onReset()
 * Handle RST_STREAM frames
 */
Stream.prototype.onReset = function onReset(frame) {
  this._rstCode = 0;
  this.destroy(null);
}

/*
 * function cancel()
 * Cancel requests by the endpoint that initiates the stream
 */
Stream.prototype.cancel = function cancel(callback) {
  this.emit('cancel');
  if (this.isPendingRequest) {
    for ( var i = 0; i < this.session.pendingRequests.length; i++) {
      if (this.session.pendingRequests[i].id == this.id) {
        this.session.pendingRequests.splice(i, 1);
      }
    }
  } else {
    this.session._rstCode = 5;
    this.destroy(new Error("Request Cancelled"));
  }

  if (callback)
    callback();
}

/*
 * function end()
 * Send FIN data frame
 */
Stream.prototype.end = function end(data, encoding, callback) {
  if (this.isGoaway())
    return;

  if (this.closedBy.client)
    return;

  this.contentLength += Buffer.byteLength(data, encoding);
  this.handleContentLength(this.contentLength);
  this._writeData(data, encoding, true, callback);
}

/*
 * function destroy()
 * Destroys stream
 */
Stream.prototype.destroy = function destroy(error) {
  if (this._destroyed)
    return;

  this._destroyed = true;

  delete this.session.streams[this.id];

  if (this.id % 2 === 1) {
    this.session.streamsCount--;
  }

  // If stream is not finished, RST frame should be sent
  if (error || !this.closedBy.server) {
    if (!this.closedBy.server) this._rstCode = 3;

    if (this._rstCode) {
      this._framer.rstFrame(this.id, this._rstCode);
    }
  }

  if (error) this.emit('error', error);

  var self = this;
  process.nextTick(function() {
    self.emit('close', !!error);
  });
};

/*
 * function close()
 * Destroys stream without error
 */
Stream.prototype.close = function close() {
  this.destroy(null);
}

/*
 * function halfClose()
 * Set the request on half-closed state (client side)
 */
Stream.prototype.halfClose = function halfClose() {
  this.closedBy.client = true;
}

/*
 * function handleClose()
 * Close stream if it was closed by both the server and the client
 */
Stream.prototype.handleClose = function handleClose() {
  if (this.closedBy.client && this.closedBy.server) {
    this.close();
  }
};

/*
 * function write()
 * Writes data to socket
 */
Stream.prototype.write = function write(data, encoding, callback) {
    // Do not send data to new connections after GOAWAY
    if (this.isGoaway())
        return;

    this._write(data, encoding, callback);
}

/*
 * function _write()
 * Writes data to socket
 */
Stream.prototype._write = function _write(data, encoding, callback) {
  if (this.closedBy.client) {
    this.emit('error', '_write : is on half closed state for stream :' + this.id);
    logger.error(data);
    return;
  }

  this.contentLength += Buffer.byteLength(data, encoding);
  this._writeData(data, encoding, false, callback);
}

/*
 * function _writeData()
 * Writes data to socket for internal use
 */
Stream.prototype._writeData = function _writeData(data, encoding, pfin, callback) {
  if (this.isPendingData) {
    this.pendingData.push({
      data: data,
      encoding: encoding,
      fin: pfin,
      callback: callback
    });

    return;
  }

  if (pfin) {
    var contentLengthHeader = this.options.headers['Content-Length'];
    if (contentLengthHeader != null) {
      var expected = this.options.headers['Content-Length'];
      if (expected != this.contentLength) {
        this.session._rstCode = 6;
        this.destroy(new Error("Invalid Content-Length"));
        return;
      }
    }
  }

  var _dataBuffer = data;
  if (!Buffer.isBuffer(data)) {
    _dataBuffer = new Buffer(data, encoding);
  }
  var _conn = this.session;
  var self = this;
  self.session._lock(function() {
    var frame = self.session.framer.dataFrame(self.id, pfin, _dataBuffer);
    self.session.write(frame);
    if (pfin)
      self.halfClose();

    self.session._unlock();

    if (callback)
      callback();
  });
}

/*
 * function _lock()
 * Acquites lock
 */
Stream.prototype._lock = function lock(callback) {
  if (!callback)
    return;

  if (this._locked) {
    this._lockBuffer.push(callback);
  } else {
    this._locked = true;
    callback.call(this, null);
  }
};

/*
 * function _unlock()
 * Releases lock and call callbacks
 */
Stream.prototype._unlock = function unlock() {
  if (this._locked) {
    this._locked = false;
    this._lock(this._lockBuffer.shift());
  }
};

/*
 * function flushPendingData()
 * Flushes pending data and call callback
 */
Stream.prototype.flushPendingData = function flushPendingData(callback) {
  var self = this;
  this.isPendingData = false;
  var p;
  this.pendingData.forEach(function(p) {
    try {
      self._writeData(p.data, p.encoding, p.fin, p.callback);
    } catch (e) {
    }
  });
  this.pendingData = [];

  if (callback)
    callback();
}

/*
 * function handleContentLength()
 * Creates content-length header
 */
Stream.prototype.handleContentLength = function handleContentLength(length) {
  var contentLengthHeader = this.options.headers['Content-Length'];
  if (contentLengthHeader == undefined) {
    this.options.headers['Content-Length'] = length;
    this.session.doPendingRequest(this);
  }
}

/*
 * function isGoaway()
 * Checks if the stream is goaway'd
 */
Stream.prototype.isGoaway = function isGoaway() {
  return this.session.goAway && this.id > this.session.goAway;
};
