exports.getRedisClient = function(){
    var redis = require("redis");
    var redisConfig = require("../config/redis.json");
    
    return redis.createClient(redisConfig.port, redisConfig.host, {});
}
