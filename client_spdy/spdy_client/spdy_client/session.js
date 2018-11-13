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
    fs = require('fs'),
    stream = require('stream'),
    events = require('events'), 
    util = require('util'),
    net = require('net'),
    tls = require('tls'), 
    spdy_client = require('../spdy_client'),
    Buffer = require('buffer').Buffer;

/*
 * function create()
 * Returns an instance of Session
 */
exports.create = function create(options) {
  return new Session(options);
}

/*
 * Constructor
 * Returns a SPDY session (connection)
 */
function Session(options) {
  process.EventEmitter.call(this);
  var self = this;

  // Initialize parameters
  this._init(options);

  // Indicates whether a tcp/tls connection is _opened
  this._closed = true;

  // Bind socket
  this._connect();

  this.deflate = this._deflate = spdy.utils.createDeflate(this.options.version);
  this.inflate = this._inflate = spdy.utils.createInflate(this.options.version);
  this.framer = new spdy.protocol['' + this.options.version].Framer(
    spdy.utils.zwrap(this.deflate),
    spdy.utils.zwrap(this.inflate)
  );

  this.on('close', function() {
    this._close();
  });

  this.on('error', function(err) {
    this.socket.emit('error', err);
  });

  // create parser that will be responsible of receiving the data from the  server
  this.parser = spdy.parser.create(this, this.deflate, this.inflate);

  // on receiving frames
  this.parser.on('frame', function(frame) {
    if (self._closed)
      return;
    spdy_client.utils.log(1, "client parser, on frame : ", frame);

    var stream = null;

    // Process frames
    if (frame.type === 'SYN_REPLY') {
      stream = self.streams[frame.id];
      if (!stream) {
        self.write(self.framer.rstFrame(frame.id, 2));
      } else {
        stream.onReceiveReply(frame);
      }
    } else if (frame.type == 'DATA') {
      stream = self.streams[frame.id];
      if (!stream) {
        self.write(self.framer.rstFrame(frame.id, 2));
      } else {
        stream.onReceiveData(frame);
      }
    } else if (frame.type === 'RST_STREAM') {
      stream = self.streams[frame.id];
      if (!stream) {
        self.write(self.framer.rstFrame(frame.id, 2));
      } else {
        stream.onReset(frame);
      }
    } else if (frame.type === 'PING') {
      if (frame.pingId % 2 == 0) {
        self.write(self.framer.pingFrame(frame.pingId));
      }
      spdy_client.utils.log(self.log_level, "--- ping response : ", frame);
      self.emit('ping', frame.pingId.readUInt32BE(0, true) & 0x7fffffff);

    } else if (frame.type === 'SETTINGS') {
      if (frame.settings['4'])
        self.maxStreamsServer = frame.settings['4'];
    }
    if (frame.fin && stream) {
      if (stream.closedBy.client) {
        stream._rstCode = 2;
        stream.emit('error', 'has already half-closed');
      } else {
        stream.closedBy.client = true;
        stream.handleClose()
      }
    }
  });
  // pipe socket with parser
  this.socket.pipe(this.parser);
}
util.inherits(Session, process.EventEmitter);

/*
 * function _init()
 * Initialization
 */
Session.prototype._init = function init(options) {
  // Initialize params passed in from the outside in this.options
  // Set up default values
  this.options = options;
  this.options.version = (options.version) ? options.version : 3;
  this.options.path = (options.path) ? options.path : '/';
  if (!options.port) {
    this.options.port = (options.plain) ? 80 : 443;
  }
  this.log_level = options.log;

  // Initialize session specific params
  this.maxStreams = (options.maxStreams) ? options.maxStreams : 1000;
  this.maxStreamsServer = -1;
  this.windowSize = (options.windowSize) ? options.windowSize : (1 << 20);
  this.streams = {};
  this.streamsCount = 0;
  this.streamId = -1;
  this.pingId = -1;
  this.goAway = 0;
  this.pendingRequests = [];
  this._rstCode = 1;
  this.lastGoodID = 0;

  // Lock data
  this._locked = false;
  this._lockBuffer = [];

}

/*
 * function _connect()
 * Set up a TCP/TLS connection (set this.socket)
 */
Session.prototype._connect = function connect() {
  var self = this;

  // Start a TCP connection
  if (this.options.plain) {
    spdy_client.utils.log(self.log_level, "--- trying plain connection");
    this.socket = net.connect(this.options.port, this.options.host, function() {
      self._start();
      self.socket.on('close', function() {
        spdy_client.utils.log(self.log_level, '--- Socket closed');
      });
    });
    this.socket.on('error', function(err) {
      spdy_client.utils.log(self.log_level, "--- tcp connection socket error : ", err.message);
    });
  } else {
  // Start a TLS connection
    spdy_client.utils.log(self.log_level, "--- trying tls connection");
    this.socket = tls.connect(this.options.port, this.options.host, {
      NPNProtocols : [ 'spdy/' + this.options.version ],
      rejectUnauthorized : false
    }, function() {
      self._start();
      self.socket.on('close', function() {
        spdy_client.utils.log(self.log_level, '--- Socket closed');
      });
    });
    this.socket.on('error', function(err) {
      spdy_client.utils.log(self.log_level, "--- tls connection socket error : ", err.message);
    });
  }
  spdy_client.utils.log(self.log_level, "--- spdy connection created w/ port: " + this.socket.localPort);
}

/*
 * function write()
 * Writes data to socket
 */
Session.prototype.write = function write(data, encoding) {
  if (this.socket.writable) {
    return this.socket.write(data, encoding);
  }
};

/*
 * function _start()
 * Callback when initializing the SPDY session
 */
Session.prototype._start = function start() {
  var self = this;
  spdy_client.utils.log(self.log_level, "--- start session");
  this._closed = false;

  this.write(this.framer.windowSizeFrame(10485760)); // 1024 * 1024; 1MB
  this.socket.setTimeout(2 * 60 * 1000);
  this.socket.once('timeout', function ontimeout() {
    spdy_client.utils.log(self.log_level, '--- session timeout');
    this.destroy();
  });
  for (var i = 0; i < this.pendingRequests.length; i++) {
    this._sendSynStream(this.pendingRequests[i]);
  }
  this.pendingRequests = [];
}

/*
 * function _close()
 * Callback when closing the SPDY session
 */
Session.prototype._close = function close() {
  spdy_client.utils.log(self.log_level, "--- close session");
  this.goaway(0);
  if (this.socket) {
    this.socket.destroy();
  }
}

/*
 * function sendRequest()
 * Send request or store it for later use
 */
Session.prototype.sendRequest = function sendRequest(options, callback) {
  var request = {
    options: options,
    callback: callback,
  };

  if (!this._closed) {
    this._sendSynStream(request);
  } else {
    this.pendingRequests.push(request);
  }
  return request;
}

/*
 * function doPendingRequest()
 * Do pending requests
 */
Session.prototype.doPendingRequest = function doPendingRequest(request) {
  if (!this._closed) {
    this.sendSynStream(request);

    // Remove pending request
    for ( var i = 0; i < this.pendingRequests.length; i++) {
      if (this.pendingRequests[i].id == req.id) {
        this.pendingRequests.splice(i, 1);
      }
    }
  }
  return request;
}

/*
 * function _sendSynStream()
 * Send out the SYN_STREAM frame
 * Note that we can't reuse what's in this.framer because it is designed
 * for the server push (with flag unidirectional)
 */
Session.prototype._sendSynStream = function sendSynStream(request) {
  var self = this;

  var stream_n = spdy_client.stream.create(self, request);
  if (!stream_n.isReady())
    return;

  // Send out the stream
  stream_n.send();
}

/*
 * function goaway()
 * Stop accepting/sending streams on this connection
 */
Session.prototype.goaway = function goaway(status) {
  var header = new Buffer(16);

  header.writeUInt32BE(0x80030007, 0, true); // Version and type
  header.writeUInt32BE(0x00000008, 4, true); // Length

  var id = new Buffer(4);

  // Server last good StreamID
  id.writeUInt32BE((this.lastGoodID) & 0x7fffffff, 0, true);
  id.copy(header, 8, 0, 4);

  var statusBuffer = new Buffer(4);
  statusBuffer.writeUInt32BE((status || 0) & 0x7fffffff, 0, true);
  statusBuffer.copy(header, 12, 0, 4);

  this.goAway = this.streamId;
  this.write(header);
}

/*
 * function _lock()
 * Acquire lock
 */
Session.prototype._lock = function lock(callback) {
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
 * Release lock and call all buffered callbacks
 */
Session.prototype._unlock = function unlock() {
  if (this._locked) {
    this._locked = false;
    this._lock(this._lockBuffer.shift());
  }
};

