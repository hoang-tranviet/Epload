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

var activity = require('./activity');
var client = require('./client');
var exec = require('child_process').exec;
var fs = require('fs');
var util = require('util');

/*
 * function create()
 * Returns an instance of Emulator
 */
exports.create = function create(json, options) {
  return new Emulator(json, options);
}

/*
 * constructor
 * Read and parse json file that contains the dependency graph
 */
function Emulator(json, options) {
  process.EventEmitter.call(this);

  // Initialize params
  this._init(json, options);

  // Construct objects, activities and natural dependencies
  var objs = json.objs;
  var deps = json.deps;

  for (var i = 0; i < objs.length; i++) {
    var obj = objs[i];

    // Handle "download"
    var download = obj.download;
    download.obj_id = obj.id;
    download.mime = download.type;
    download.type = "download";
    obj.download = download;

    //console.log("--- [obj]", obj);

    // Index obj by obj.id
    this.objs[obj.id] = obj;
    this.acts[download.id] = download;
    this.num_activities++;

    // Handle array of "comp"
    for (var j = 0; j < obj.comps.length; j++) {
      var comp = obj.comps[j];
      comp.obj_id = obj.id;

      // Add natural dependency
      // Depends on download activity
      // Depends on its previous comp activity
      var a1 = (j == 0) ? download.id : obj.comps[j - 1].id;
      deps.push({
        id: "dep" + deps.length,
        a1: a1,
        a2: comp.id,
        time: -1,
      });

      this.acts[comp.id] = comp;
      this.num_activities++;
    }
  }

  // Add dependencies to activities
  for (var i = 0; i < deps.length; i++) {
    var dep = deps[i];
    var a1 = this.acts[dep.a1];
    var a2 = this.acts[dep.a2];

    // Add to a2 that 'a2 depends on a1'
    if (!a2.deps)
      a2.deps = [];

    a2.deps.push({
      id: a1.id,
      time: dep.time,
    });

    // Add to a1 that 'a1 depends on a2'
    if (!a1.triggers)
      a1.triggers = [];

    a1.triggers.push({
      id: a2.id,
      time: dep.time,
    });
  }

  // Additional processing for prioritization and server push
  if (this.options.priority_type == 2 || this.options.server_push_type == 2) {
    this._calculateDepth();
  }

  // Modify dependency graph accordingly for server push
  if (this.options.server_push_type) {
    this._serverPushGraph();
  }

  // Write to file if we say we want to print out the stats
  if (this.options.is_print_stats) {
    var filename = "stats/" + this.json.name;
    var out = "";

    for (var i in this.acts) {
      var act = this.acts[i];
      if (act.type == "download") {
        // We need to write here
        var obj_id = act.obj_id;
        var obj = this.objs[obj_id];
        var path = obj.path;

        // Find if this act belongs to this.server_push_activities[]
        var is_pushed = 0;
        for (var i in this.server_push_activities) {
          if (act.id == this.server_push_activities[i]) {
            is_pushed = 1;
            break;
          }
        }
        out += obj.path + "\t" + act.depth.obj + "\t" + act.depth.act + "\t" + is_pushed + "\n";
      }
    }

    fs.writeFileSync(filename, out);
  }

  console.log("=== [web objects]", this.objs);
  console.log("=== [activities]", this.acts);
}
util.inherits(Emulator, process.EventEmitter);

/*
 * Run the emulator to make real http/spdy requests
 */
Emulator.prototype.run = function run() {
  // Get the baseline of timestamp
  this.hr_base = process.hrtime();

  // Start the first activity
  this.createActivity(this.json.start_activity);

  // Do server push if it is enabled
  if (this.options.server_push_type && this.server_push_activities) {
    for (var i in this.server_push_activities) {
      var act_id = this.server_push_activities[i];
      //console.log("----- [server push id", act_id);
      this.createActivity(act_id);
    }
  }
}

/*
 * Create and start a new activity
 */
Emulator.prototype.createActivity = function createActivity(id) {
  var act_obj = activity.create({
    em: this,
    id: id,
  });
  act_obj.start();
}

/*
 * Check if all activities on the page are finished
 */
Emulator.prototype.scaledTime = function scaledTime(time) {
  var time_n = time * this.options.alpha + this.options.beta;
  if (time_n > 0)
    return time_n;

  return 0;
}

/*
 * Check if all activities on the page are finished
 */
Emulator.prototype.checkFinish = function checkFinish() {
  if (this.num_complete < this.num_activities)
    return false;

  return true;
}

/*
 * Callback when all activities on the page are finished
 */
Emulator.prototype.onFinish = function onFinish(act) {
  if (!this.checkFinish())
    return;

  //var plt = this.acts[this.json.load_activity].ts_e;
  var plt = act.ts_e;
  console.log("=== [page load time]", plt);
  this.emit('finish', plt);
}

/*
 * Check whether depended activities are all 'done'
 */
Emulator.prototype.checkDependedActivities = function checkDependedActivities(id) {
  var self = this; // self refers to the emulator
  var act_trigger = self.acts[id];

  // act_trigger.deps should not be empty (at least the current activity)
  var is_all_complete = true;
  for (var i = 0; i < act_trigger.deps.length; i++) {
    var dep = act_trigger.deps[i];

    if (dep.time < 0) {
      if (!self.map_complete[dep.id]) {
        is_all_complete = false;
        break;
      }
    } else {
      if (!self.map_start[dep.id]) {
        is_all_complete = false;
        break;
      }
    }
  }
  //console.log("------ [checkDependedActivities]", id, is_all_complete);

  return is_all_complete;
}

/*
 * Initialize params
 */
Emulator.prototype._init = function init(json, options) {
  this.options = options;
  var client_options = {
    maxSockets: 6,
    https: false,
    //port: 80,
    log: true,
    use_spdy: options.use_spdy,
    priority: 6,
  };
  this.json = json;
  this.client = client.create(client_options);

  this.objs = [];
  this.acts = [];
  this.map_start = [];
  this.map_complete = [];
  this.num_start = 0;
  this.num_partial_complete = 0; // For downloads that trigger other things upon receiving the 1st chunk
  this.num_complete = 0;
  this.num_activities = 0;
  this.is_finished = false;
}

/*
 * Customized setTimeout
 */
Emulator.prototype._setTimeout = function setTimeout(callback, timeout) {
  var self = this;

  var diff = process.hrtime(self.hr_base);
  console.log("_setTimeout start:", diff[0] * 1000 + diff[1] / 1000000);

  // Set timer
  var child = exec('perl timeout.pl ' + timeout,
    function (error, stdout, stderr) {
      if (error)
        return;

  var diff = process.hrtime(self.hr_base);
  console.log("_setTimeout finish:", diff[0] * 1000 + diff[1] / 1000000);

      // Call
      if (callback != null)
        callback.apply(self);
    }
  );
}

/*
 * Calculate the depth of each download activity backwards
 * Called only by the constructor
 */
Emulator.prototype._calculateDepth = function calculateDepth() {
  // Initial scan of this.acts object
  var num_acts_total = 0;
  var num_acts_visited = 0;
  for (var id in this.acts) {
    num_acts_total++;
  }
  //console.log("----- [# acts]", num_acts_total);

  // Visit one activity at a time
  while (num_acts_visited < num_acts_total) {
    for (var id in this.acts) {
      var act = this.acts[id];

      // Skip activities that have been assigned depth
      if (act.depth != null)
        continue;

      // Check if all depended activities have been assigned a depth.
      // Mark as visited and assign corresponding depth if so.
      var depth = this._calculateActivityDepth(act);
      if (depth != null) {
        act.depth = depth;
        this.acts[id] = act;
        num_acts_visited++;
      }
    }
  }

  // Set the depth of root html
  var act_root = this.acts[this.json.start_activity];
  this.root_depth = act_root.depth;
}

/*
 * Calculate the depth of each download activity backwards
 * Called only by _calculateDepth()
 */
Emulator.prototype._calculateActivityDepth = function calculateActivityDepth(act) {
  var depth_obj = 1;
  var depth_act = 1;

  for (var id_trigger in act.triggers) {
    var act_trigger = act.triggers[id_trigger];
    var act_trigger_obj = this.acts[act_trigger.id];

    if (!act_trigger_obj.depth) {
      return null;
    }

    // Calculate corresponding  depth
    if (act_trigger_obj.depth.act + 1 > depth_act)
      depth_act = act_trigger_obj.depth.act + 1;

    // For download activity, depth + 1
    // For computation activity, depth remains the same
    var inc_depth = (act_trigger_obj.type == "download") ? 1 : 0;
    if (act_trigger_obj.depth.obj + inc_depth > depth_obj)
      depth_obj = act_trigger_obj.depth.obj + inc_depth;
  }

  return {
    obj: depth_obj,
    act: depth_act,
  };
}

/*
 * Change the dependency graph
 * Called only by the constructor
 */
Emulator.prototype._serverPushGraph = function serverPushGraph() {
  // Create an array that stores ids of server-pushed activities
  this.server_push_activities = [];

  for (var id_obj in this.objs) {
    var obj = this.objs[id_obj];
    var id = obj.download.id;

    // Skip the root
    if (id == this.json.start_activity)
      continue;

    // Check whether this download activity should be pushed
    if (this._shouldPushActivity(id)) {
      // Add to the push activity array
      this.server_push_activities.push(id);

      var act = this.acts[id];

      // Add collapsed dependency
      if (act.triggers && act.deps) {
        for (var i in act.deps) {
          var act_prev_id = act.deps[i].id;
          var act_prev_time = act.deps[i].time;
          var act_prev = this.acts[act_prev_id];
          for (var j in act.triggers) {
            var act_succ_id = act.triggers[j].id;
            var act_succ = this.acts[act_succ_id];

            // Add dependency
            //console.log("----- [connect]", act.deps[i], act_prev, act.triggers[j], act_succ);
            act_succ.deps.push({
              id: act_prev_id,
              time: act_prev_time,
            });

            act_prev.triggers.push({
              id: act_succ_id,
              time: act_prev_time,
            });

            this.acts[act_succ_id] = act_succ;
          }

          this.acts[act_prev_id] = act_prev;
        }
      }

      // Remove the dependencies that the download activity depends on
      // Note that we don't have to do this
    }
  }
}

/*
 * Check whether an activity should be pushed based on server_push_type and the depth
 * Called only by _serverPushGraph()
 */
Emulator.prototype._shouldPushActivity = function shouldPushActivity(id) {
  // type 1: always push
  if (this.options.server_push_type == 1)
    return true;

  var act = this.acts[id];

  // type 2: push according to depth
  if (this.options.server_push_type == 2) {
    if (!this.options.server_push_depth)
      return false;

    if (act.depth.obj >= this.root_depth.obj - this.options.server_push_depth) {
      return true;
    }

  // type 3: push according to embedding depth
  } else if (this.options.server_push_type == 3) {
    var rid = this.acts[this.json.start_activity].obj_id;

    for (i in act.deps) {
      var dep = act.deps[i];
      //console.log("----- [dep]", dep);
      var arr = dep.id.split("_");
      if (arr[0] == rid)
        return true;
    }
  }

  return false;
}
