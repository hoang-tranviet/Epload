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

var spdy_client = require('../spdy_client');

/*
 * function create()
 * Returns an instance of Client
 */
exports.create = function create(options) {
  return new Client(options);
}

/*
 * Constructor
 * SPDY client
 */
function Client(options) {
  // Initialize params
  this.options = options;
  this.options.version = (options.version) ? options.version : 3; // TODO enable both 2 and 3
  if (!options.port) {
    this.options.port = (options.plain) ? 80 : 443;
  }

  // Store sessions with url as the key
  this.sessions = {};
}

/*
 * function get()
 * HTTP GET
 */
Client.prototype.get = function get(options, callback) {
  var _options = options;
  _options.method = 'GET';
  return this.request(_options, callback);
}

/*
 * function post()
 * HTTP POST
 */
Client.prototype.post = function(options, callback) {
    var _options = options;
    _options.method = 'POST';
    return this.request(_options, callback);
}

/*
 * function request()
 * Send an HTTP request
 */
Client.prototype.request = function(options, callback) {
  var session = this._getSession(options);
  return session.sendRequest(options, callback);
}

/*
 * function getSession
 * Get the SPDY session (connection)
 */
Client.prototype._getSession = function(options) {
  var key = (options.plain ? "http" : "https") + "://" + options.host + ":" + options.port;
  var session = this.sessions[key];
  if (!session) {
    // Create a new SPDY session
    options.version = this.options.version;
    session = spdy_client.session.create(options);
    this.sessions[key] = session;
  }
  return session;
}
