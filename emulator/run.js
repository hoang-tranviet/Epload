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
var exec = require('child_process').exec;
var StringDecoder = require('string_decoder').StringDecoder, decoder = new StringDecoder('utf8');
var emulator = require('./emulator');

if (process.argv.length < 3) {
  console.log('Usage: node ' + process.argv[1] + ' directory');
  process.exit(1);
}

var use_spdy = (process.argv[2] == "spdy") ? true : false;
var directory = process.argv[3];

// Configure parameters here
var options = {
  use_spdy: use_spdy,
  // Scaling factors for computation
  alpha: 1, // Scaling factor to computation
  beta: 0, //

  // Prioritization
  priority_type: 0, // 0: no priority; 1: html > js, css > *; 2: depth
  priority_lmax: 0,
  priority_lmin: 7,

  // Server push
  server_push_type: 0, // 0: no server push; 1: push everything; 2: depth; 3. by embedding level
  server_push_depth: 0,

  // Domain sharding
  domain_sharding_type: 0, // 0: no sharding; 1: sharding based on full domain; 2: sharding based on top-level domain (TLD)

  // Just print stats
  is_print_stats : 0,
};


var child = exec('ls ' + directory,
  function (error, stdout, stderr) {
    if (error)
      return;

    // No error
    var files = stdout.split("\n");
    var i = -1;

    var callback_finish = function(plt) {

      var file = null;
      while (!file) {
        i++;
        if (i >= files.length)
          process.exit(1);
        file = files[i];
      }

      // Run tests of this file
      console.log('=== [page file]', file);

      var buffer = fs.readFileSync(directory + "/" + file);
      var data = decoder.write(buffer);
      var json = JSON.parse(data);
      //console.log(json);

      var em = emulator.create(json, options);
      em.on('finish', callback_finish);
      if (!options.is_print_stats)
        em.run();
    }

    // Start the loop
    // This is to guarantee that the emulator runs sequentially
    callback_finish(-1);
});
