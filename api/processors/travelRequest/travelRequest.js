//set mongo db connection and schema
var db = require('../../lib/db');
db.getModel('usertravels', function(err, model) {
    if (err) {
        console.log('Fatal error: ' + err + '. On generating travel collection (Model)');
    } else {
        Travel = model;
    }
});
//require travel class that does actual activities
var tclass = require('./travelClass');
//for beta processing
var betap = require('./betaProc');


// Retrieve travel context

var req = function(body, user, client, callback) {
    console.log ("\n Processor : Travel Request by " + user.name);
    //get user and client info records
    var sinfo = { "username":user.name, "slackHandle":client.slackHandle, "booked": false };
    var reply = "";
    var error = '';
    var fn = new tclass(body);
    var entity = fn.entGet();
    //check if object is empty and ignore find/update
    //get object and entity to match defined schema for initial save
    var fobj = fn.merge(sinfo, entity, function(res,err) {
        if(res) {
            console.log('\nobject combination succesfull' + JSON.stringify(res));
        } else {
            console.log(err);
        }
    });


        try {
            //find record or create if it doesnt exit
            Travel.findOneAndUpdate(sinfo,fobj,{upsert: true, new:true}, function (err, travelobject) {
                if(err) {
                    console.log('Error occurred during db commit' + err);
                } else {
                    console.log('returned object' + "\n" + travelobject);
                        reply = betap(travelobject);
                        console.log(reply);
                        callback(error, reply);
                }

            });
           // after retrieving the record call method check parameters to populate response
        } catch(e){
            console.log("exception during database operation " + e);
            callback(error,e);
        }

};


module.exports.run = req;