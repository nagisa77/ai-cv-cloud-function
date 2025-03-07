const redis = require('redis');

const client = redis.createClient({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD
});

client.on('error', (err) => {
    console.error('Redis Error:', err);
});

client.on('connect', () => {
    console.log('Connected to Redis');
});

module.exports = client;