var client = require('./client.js');

if (process.argv.length < 3) {
  console.log('Usage: node ' + process.argv[1] + ' filename');
  process.exit(1);
}

var options = {
  maxSockets: 6,
  port: 80,
  filename: process.argv[2], // required field
  log: true,
};

if (client.prepare(options)) {
  client.request();
}
