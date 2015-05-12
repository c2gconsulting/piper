var mongoose = require('mongoose');
//create mongoose schema
var schema = new mongoose.Schema({
          name          : String
        , clientHandle  : String
        , token  : []
});

//static methods
schema.statics.getUserAuthorisation = function(name, client, callback) {
    var promise = new mongoose.Promise;
    if(callback) promise.addBack(callback);

    GoogleCalendarUser.findOne({'name' : name, 'clientHandle' : client }).exec( function(err, doc) {
        if (err) {
            promise.error(err);
            return;
        }
        promise.complete(doc);
    });

    return promise;

};

schema.statics.updateUserAuthorisation = function(name, client, token, callback) {
    var promise = new mongoose.Promise;
    if(callback) promise.addBack(callback);

    GoogleCalendarUser.update({'name' : name, 'clientHandle' : client}, { token: token}, { upsert : true }).exec( function(err, doc) {
        if (err) {
            promise.error(err);
            return;
        }
        promise.complete(doc);
    });

    return promise;

};

// Return a GoogleCalendarUser model based upon the defined schema
module.exports = GoogleCalendarUser = mongoose.model('google_calendar_users', schema);