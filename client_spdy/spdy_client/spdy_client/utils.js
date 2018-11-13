var utils = exports;

/*
 * function headersToDict()
 * Converts object into spdy dictionary
 */
utils.headersToDict = function headersToDict(headers, preprocess) {
  function stringify(value) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        return value.join('\x00');
      } else if (typeof value === 'string') {
        return value;
      } else {
        return value.toString();
      }
    } else {
      return '';
    }
  }
  Buffer = require('buffer').Buffer;

  /* Lower case of all headers keys */
  var loweredHeaders = {};
  Object.keys(headers || {}).map(function(key) {
    loweredHeaders[key.toLowerCase()] = headers[key];
  });

  /* Allow outer code to add custom headers or remove something */
  if (preprocess)
    preprocess(loweredHeaders);

  /* Transform object into kv pairs */
  var len = 4;
  var pairs = Object.keys(loweredHeaders)
    .filter(
      function(key) {
        var lkey = key.toLowerCase();
        return lkey !== 'connection' && lkey !== 'keep-alive'
          && lkey !== 'proxy-connection'
          && lkey !== 'transfer-encoding';
      })
    .map(
      function(key) {
        var klen = Buffer.byteLength(key);
        var value = stringify(loweredHeaders[key]);
        var vlen = Buffer.byteLength(value);

        len += 8 + klen + vlen;
        return [ klen, key, vlen, value ];
      }), result = new Buffer(len);

  result.writeUInt32BE(pairs.length, 0, true);

  var offset = 4;
  pairs.forEach(function(pair) {
    /* Write key length */
    result.writeUInt32BE(pair[0], offset, true);
    /* Write key */
    result.write(pair[1], offset + 4);

    offset += pair[0] + 4;

    /* Write value length */
    result.writeUInt32BE(pair[2], offset, true);
    /* Write value */
    result.write(pair[3], offset + 4);

    offset += pair[2] + 4;
  });

  return result;
};


/*
 * function log()
 */
utils.log_level = 1;
utils.log = function() {
  var level = arguments[0];
  if (level > this.log_level) {
    var argv = Array.prototype.slice.call(arguments);;
    argv.splice(0, 1);
    console.log.apply(this, argv);
  }
}
