/*
 * This software is licensed under the MIT license: http://www.opensource.org/licenses/MIT
 *
 * Copyright (c) 2014 University of Washington
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of 
 * this software and associated documentation files (the "Software"), to deal in the 
 * Software without restriction, including without limitation the rights to use, copy, 
 * modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, 
 * and to permit persons to whom the Software is furnished to do so, subject to the 
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies 
 * or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, 
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR 
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE 
 * FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR 
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 */

var fs = require('fs'),
    spdy_client = require('./spdy_client/spdy_client'),
    util = require('./util');

var client = exports;

///////////// Variables
client.ts_start = util.ts();
client.res_count = 0;
client.connection_pool = {}; // We need to write our own connection pool so that spdy requests are made from a single connection

util.init_ts(client.ts_start);

////////////// Functions
/*
 * Synchronously read requests info from file
 */
client.prepare = function(options) {
  // Check the required fields
  if (!options.filename) {
    return false;
  }

  // Set the optional fields if any
  if (options.port) {
    this.port = options.port;
  }
  if (options.log) {
    this.log = options.log;
  }

  // Read from file
  var data = fs.readFileSync(options.filename, {encoding: 'utf8'});

  // Parse file inputs
  var lines = data.split("\n");
  this.reqs = [];
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i])
      continue;
    var items = lines[i].split("\t");
    this.reqs.push({
      host: items[0],
      path: items[1],
      ts: parseInt(items[2]),
    });
  }

  // Create spdy client
  this.options = {
    plain: 1,
    http_version: 'HTTP/1.1',
    accept: '*/*',
    accept_encoding: 'gzip,deflate',
    user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/534.24 (KHTML, like Gecko) Chrome/11.0.696.34 Mobile Safari/534.24',
    log: options.log,
  };
  this.spdy_client = spdy_client.client.create(this.options);
  return true;
}

/*
 * Make requests according to the timestamps
 */
client.request = function() {
  var self = this;
  for (var i = 0; i < this.reqs.length; i++) {
    var r = this.reqs[i];
    setTimeout(function(sc, i) {
      var r = sc.reqs[i];

      var options = {
        host: r.host,
        path: r.path,
        url: '/',
        port: sc.port,
        plain: 0, // TODO
        connection_pool: sc.connection_pool, // TODO
      };

      var callback = function(stream) {
        var str = '';
        stream.on('data', function(data, fin) {
          if (fin) {
            if (self.log) {
              util.log("Responding " + stream._frame_reply.headers.status);
            }
            self._onResponse(data);
          }
        });
      }

      // Make requests
      if (self.log) {
        util.log("Requesting " + i + "-th url: " + r.host);
      }
      self.options.host = r.host;
      self.options.path = r.path;
      self.options.priority = 6;
      var req = self.spdy_client.get(self.options, callback);
    }, r.ts, this, i);
  }
}

client._onResponse = function(data) {
  this.res_count++;
  if (this.res_count == this.reqs.length) {
    if (this.log) {
      util.log("Done!");
    }
    process.exit(1);
  }
}

