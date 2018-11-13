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

/*
 * function create()
 * Returns an instance of Activity
 */
exports.create = function create(options) {
  return new Activity(options);
}

/*
 * constructor
 */
function Activity(options) {
  this.em = options.em;
  this.id = options.id;
}

/*
 * function start()
 * Start an activity
 */
Activity.prototype.start = function start() {
  var self = this; // self refers to the activity
  var id = self.id;
  var act = self.em.acts[id];
  self.act = act;

  // Skip if this activity is already called
  if (act.is_started)
    return;

  // Set is_started that this activity has been called
  self.em.acts[id].is_started = true;

  // Get start timestamp
  var diff = process.hrtime(self.em.hr_base);
  self.em.acts[id].ts_s = diff[0] * 1000 + diff[1] / 1000000;
  console.log("=== [start][" + self.em.acts[id].ts_s + "]", id);

  if (act.type == "download") {
    // For "download" activity
    var obj = self.em.objs[act.obj_id];
    var callback_data = (obj.when_comp_start > 0) ? self.onComplete : null;
    var opts = {
      host: obj.host,
      path: obj.path,
      url: obj.url,
      activity: self,
      id: id,
      when_comp_start: obj.when_comp_start,
      priority: self._getPriority(self.em.options.priority_type),
      domain_sharding_type: self.em.options.domain_sharding_type,
    };
    console.log("----- [priority]", opts.priority, act.id);
    self.em.client.request(opts, callback_data, self.onComplete);
  } else {
    // For "comp" activity
    (function(id) {
      setTimeout(function() {
        self.onComplete();
      }, self.em.scaledTime(act.time));
    })(id);
  }

  self.em.map_start[id] = 1;
  self.em.num_start++;

  // Check whether should trigger dependent activities when 'time' != -1
  if (act.triggers) {
    for (var i = 0; i < act.triggers.length; i++) {
      var trigger = act.triggers[i];
      if (trigger.time > 0) {
        var func_id = id + "|" + trigger.id;
        (function(func_id) {
          var trigger_id = trigger.id;
          var trigger_time = trigger.time;
          setTimeout(function() {

	    // Timestamp
	    // Get start timestamp
  var diff = process.hrtime(self.em.hr_base);
  var ts = diff[0] * 1000 + diff[1] / 1000000;
  //console.log("------ [trigger.id][" + ts + "]", trigger_id);


            // Check whether all activities that trigger.id depends on are finished
            if (self.em.checkDependedActivities(trigger_id)) {
              var opts = {
                em: self.em,
                id: trigger_id,
              };
              //console.log("=== setTimeout", opts);
              self.em.createActivity(trigger_id);
            }
          }, self.em.scaledTime(trigger_time));
        })(func_id);
      }
    }
  }
}

/*
 * function onComplete()
 * Callback on an activity complete
 */
Activity.prototype.onComplete = function onComplete(is_partial) {
  var self = this; // self refers to the activity
  var id = self.id;

  // Get end timestamp
  var diff = process.hrtime(self.em.hr_base);
  self.em.acts[id].ts_e = diff[0] * 1000 + diff[1] / 1000000;

  // log
  var act = JSON.parse(JSON.stringify(self.em.acts[id]));
  delete act.triggers;
  delete act.deps;
  delete act.time;
  delete act.obj_id;
  console.log("=== [onComplete][" + self.em.acts[id].ts_e + "]", JSON.stringify(act));

  if (!self.em.map_complete[id]) {
    self.em.map_complete[id] = 1;
    self.em.num_partial_complete++;

    // Check whether should trigger dependent activities when 'time' == -1
    var act = self.em.acts[id];
    if (act.triggers) {
      for (var i = 0; i < act.triggers.length; i++) {
        var trigger = act.triggers[i];
        if (trigger.time == -1) {
          // Check whether all activities that trigger.id depends on are finished
          if (self.em.checkDependedActivities(trigger.id)) {
            self.em.createActivity(trigger.id);
          }
        }
      }
    }
  }

  if (!is_partial) {
    self.em.num_complete++;
  }

  // Check whether page load is finished
  if (self.em.checkFinish())
    self.em.onFinish(act);
}

/*
 * function _getPriority()
 * Callback on an activity starts
 * Called only in start()
 */
Activity.prototype._getPriority = function getPriority(priority_type) {
  var self = this;
  var act = self.act;

  // type 0 means thre is no priority
  if (priority_type == 0) {
    return 6;
  }

  // type 1 means priority corresponds to html > js, css > *
  if (priority_type == 1) {
    // Match html
    var m = act.mime.match(/html/g);
    if (m != null) return 4;

    // Match javascript and css
    var m_js = act.mime.match(/javascript/g);
    var m_css = act.mime.match(/css/g);
    if (m_js != null || m_css != null) return 5;

    // Otherwise it's the default priority 6
  }

  // type 2 means priority corresponds to depth
  if (priority_type == 2) {
    // self.em.json.start_activity
    console.log("----- [root depth]", self.em.root_depth);
    return self._getPriorityLevel(act.depth);
  }

  return 6;
}

/*
 * function _getPriorityLevel()
 * Callback on an activity starts
 * Called only in _getPriority()
 */
Activity.prototype._getPriorityLevel = function getPriorityLevel(depth) {
  var self = this;

  var lmax = self.em.options.priority_lmax;
  var lmin = self.em.options.priority_lmin;
  var droot = self.em.root_depth.obj;
  var dx = depth.obj;

  if (self.em.root_depth.obj == 1)
    return 0;

  // Linearly map the depth to available priorities
  return Math.floor((lmax * (dx - 1) - lmin * (dx - droot)) / (droot - 1));
}
