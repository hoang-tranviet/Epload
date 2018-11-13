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

var http = require('http');
var fs = require('fs');
var util = require('./util.js');

///////////// Variables
exports.ts_start = util.ts();
exports.reqs = [];
exports.agent = http.globalAgent;
exports.res_count = 0;
exports.agent.maxSockets = 6; // Set up max concurrent tcp conn.
exports.port = 80;
exports.log = false;

util.init_ts(exports.ts_start);

////////////// Functions
/*
 * Synchronously read requests info from file
 */
exports.prepare = function(options) {
  // Check the required fields
  if (!options.filename) {
    return false;
  }

  // Set the optional fields if any
  if (options.port) {
    this.port = options.port;
  }
  if (options.maxSockets) {
    this.agent.maxSockets = options.maxSockets;
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
  return true;
}

/*
 * Make requests according to the timestamps
 */
exports.request = function() {
  for (var i = 0; i < this.reqs.length; i++) {
    var r = this.reqs[i];
    setTimeout(function(hc, i) {
      var r = hc.reqs[i];

      var options = {
        host: r.host,
        path: r.path,
        agent: hc.agent,
      };

      var callback = function(response) {
        var str = '';
        response.on('data', function(chunk) {
          str += chunk;
        });
        response.on('end', function() {
          if (exports.log) {
            util.log("Responding " + response.statusCode + " " + str.length);
          }
          exports._onResponse(str);
        });
      }

      // Make requests
      if (exports.log) {
        util.log("Requesting " + i + "-th url: " + r.host);
      }
      http.request(options, callback).end();
    }, r.ts, this, i);
  }
}

exports._onResponse = function(data) {
  this.res_count++;
  if (this.res_count == this.reqs.length) {
    if (this.log) {
      util.log("Done!");
      process.exit(1);
    }
  }
}

