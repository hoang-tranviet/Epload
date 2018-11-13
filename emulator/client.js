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

var fs = require('fs');
var http = require('http');
var https = require('https');
var spdy_client = require('../client_spdy/spdy_client/spdy_client.js');

/*
 * function create()
 * Returns an instance of Client
 */
exports.create = function create(options) {
  return new Client(options);
}

/*
 * constructor
 */
function Client(options) {
  this.options = options;
  this._init();
}

/*
 * Make requests according to the timestamps
 */
Client.prototype.request = function request(o, callback_data, callback_end) {
  if (this.options.use_spdy)
    this.request_spdy(o, callback_data, callback_end);
  else
    this.request_http(o, callback_data, callback_end);
}

Client.prototype.request_spdy = function request_spdy(o, callback_data, callback_end) {
  var self = this;

  // Get SPDY client based on o.url
  var index = self._parse_url(o.url, o.domain_sharding_type);
  console.log("----- [domain]", index);

  var client = self.spdy_clients[index];
  if (!client) {
    client = spdy_client.client.create(self.spdy_options);
    self.spdy_clients[index] = client;
  }

  var callback = function(stream) {
    var count = 0;
    stream.on('data', function(data, fin) {
      count++;
      if (callback_data && o.when_comp_start == count)
        callback_data.call(o.activity, true);

      if (fin) { // 'end'
        callback_end.call(o.activity);
      }
    });
  }

  // Make requests
  if (self.log) {
    //console.log("Requesting " + i + "-th url: " + r.host);
  }

  // Set spdy_options
  self.spdy_options.host = o.host;
  self.spdy_options.path = o.path;

  // Set priority
  self.spdy_options.priority = (this.options.priority != null) ? this.options.priority : 6;
  if (o.priority != null) {
    self.spdy_options.priority = o.priority;
  }
  //console.log("----- [opitons]", o);

  var req = client.get(self.spdy_options, callback);
}

Client.prototype.request_http = function request_http(o, callback_data, callback_end) {
  var options = {
    path: o.path,
    agent: this.agent,
    method: 'GET',
  };

  if (this.https) {
    options.hostname = o.host;
    //--- Ensuring self-signed cert
    options.rejectUnauthorized = false;
    options.requestCert = true;
    options.agent = false;
    options.port = 443;
    //---
  } else {
    options.host = o.host;
    options.port = 80;
    options.agent = false;
  }

  var callback = function(response) {
    //var str = '';
    var count = 0;
    response.on('data', function(chunk) {
      //str += chunk;
      count++;

      if (callback_data && o.when_comp_start == count)
        callback_data.call(o.activity, true);
    });
    response.on('end', function() {
      if (callback_end)
        callback_end.call(o.activity);
    });
  }

  // Make requests
  if (this.log) {
    //console.log("Requesting " + i + "-th url: " + r.host);
  }
  if (this.https) {
    https.request(options, callback).end();
  } else {
  console.log("options ", options);
    http.request(options, callback).end();
  }
}

/*
 * Initialize params
 */
Client.prototype._init = function init() {
  if (this.options.use_spdy)
    this._init_spdy();
  else
    this._init_http();
}

Client.prototype._init_spdy = function init_spdy() {
  // Set the default fields
  this.spdy_options = {
    plain: 1,
    http_version: 'HTTP/1.1',
    accept: '*/*',
    accept_encoding: 'gzip,deflate',
    user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/534.24 (KHTML, like Gecko) Chrome/11.0.696.34 Mobile Safari/534.24',
    log: this.options.log,
  };

  this.spdy_clients = [];

  // Set the optional fields if any
  if (this.options.port) {
    this.port = this.options.port;
  }
  if (this.options.log) {
    this.log = this.options.log;
  }

  // Create SPDY client
  this.spdy_clients[0] = spdy_client.client.create(this.spdy_options);
}

Client.prototype._init_http = function init_http() {
  // Set the default fields
  this.reqs = [];
  this.res_count = 0;
  this.log = false;
  this.https = this.options.https;
  console.log("using https: ", this.https);
  if (this.https) {
    this.port = 443;
    this.agent = https.globalAgent;
  } else {
    this.port = 80;
    this.agent = http.globalAgent;
  }
  this.agent.maxSockets = 6;

  // Check the required fields
  // TODO

  // Set the optional fields if any
  if (this.options.port) {
    this.port = this.options.port;
  }
  if (this.options.maxSockets) {
    this.agent.maxSockets = this.options.maxSockets;
  }
  if (this.options.log) {
    this.log = this.options.log;
  }
}

Client.prototype._parse_url = function parse_url(url, domain_sharding_type) {
  var self = this;

  // Always the same connection
  if (domain_sharding_type == 0)
    return 0;

  var arr = url.split("/");
  var arr1 = arr[2].split(":");
  var domain = arr1[0];

  if (domain_sharding_type == 1)
    return domain;

  return self._get_tld(domain);
}

Client.prototype._get_tld = function get_tld(domain) {
  var a = domain.split(".");
  var n = a.length;
  if (n >= 2)
    return a[n - 2] + "." + a[n - 1];
  return domain;
}

