var util = exports;

util.ts_start = -1;

util.ts = function() {
  return (new Date()).getTime();
}

util.log = function(s) {
  var t = (this.ts() - this.ts_start) / 1000;
  console.log("[" + t + "]\t" + s);
}

util.init_ts = function(ts) {
  this.ts_start = ts;
}
