const redis = require('redis');

const client = redis.createClient({
  host: '23.159.248.46',
  port: 6379,
  password: 'qq1216414009'
});

client.on('error', (err) => {
  console.error('Redis Error:', err);
});

client.on('connect', () => {
    console.log('Connected to Redis');
});

module.exports = client;