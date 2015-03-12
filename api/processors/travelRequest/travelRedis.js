//require travel class that does actual activities
var tclass = require('./travelClass');
//for beta processing
var betap = require('./betaProc');
//require redis cache clear settings
var ttl_time = require('./settings');

//using redis to temporarily cache data;
var rd_client = require('../../lib/cache').getRedisClient();
rd_client.on('error', function(error) {
    console.log("Redis Error " + error );
});

var req = function(body, user, client, callback) {
    console.log ("\n Processor : Travel Request by " + user.name);
    var rkey =  user.name.toUpperCase() + "@" + client.slackHandle.toUpperCase() + ":TRAVEL_REQ";
    var fn = new tclass(body);
    var reply = '';
    var entity = fn.entGet();
    console.log("check returned entity : " + JSON.stringify(entity));
        try {

            //set and update record in redis cache
            rd_client.hmset(rkey,entity, function(err, status) {
                if(err) {
                    console.log('Error occurred during redis operation ' + err);
                } else {
                    console.log('redis set value status ' + status);
                    //get all cached data including update and process with betaProc
                    rd_client.hgetall(rkey, function(err, result) {
                        if (err) {
                            console.log('An error occured when retrieving cached data ' + err );
                        } else {
                            console.log('Returned object from hgetall' + JSON.stringify(result));
                            //use betap processing to return response;
                            reply = betap(result);
                            console.log(reply);
                            callback(null, reply);
                        }
                    });
                }

            });
           // after retrieving the record call method check parameters to populate response
        } catch(e){
            console.log("exception during leave processing " + e);
            callback(null,e);
        }
    //reset Cache expiration

    rd_client.expire(rkey, ttl_time.LEAVE_CACHE_TIMEOUT);

};


module.exports.run = req;