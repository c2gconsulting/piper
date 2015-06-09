var mongoose = require('mongoose');

// Create a new schema for our mail user data
var schema = new mongoose.Schema({
    userid          : String
    ,slack_name    : String
    , clientHandle  : String
    ,first_name      : String
    , last_name       : String
    , active          : Boolean
    , createdAt       : { type: Date, default: Date.now }
    , emails     : [{
        username   : String
        , active   : String
    }]
    ,settings   :  [{
        'receive_on_slack' : {type: String, default: false }
    }]
});

// Static methods
schema.statics.getMailUserByEmail = function(email, callback) {
    var promise = new mongoose.Promise;
    if(callback) promise.addBack(callback);

    MailUser.findOne({ 'email.username' : email }).exec( function(err, doc) {
        if (err) {
            promise.error(err);
            return;
        }
        promise.complete(doc);
    });

    return promise;

};

schema.statics.getMailUserById = function(id, callback) {
    var promise = new mongoose.Promise;
    if(callback) promise.addBack(callback);

    MailUser.findOne({ 'userid' : id }).exec( function(err, doc) {
        if (err) {
            promise.error(err);
            return;
        }
        promise.complete(doc);
    });

    return promise;

};

schema.statics.getMailUserBySlackNameAndClient = function(name, client, callback) {
    var promise = new mongoose.Promise;
    if(callback) promise.addBack(callback);

    MailUser.findOne({ 'slack_name' : name, 'clientHandle' : client }).exec( function(err, doc) {
        if (err) {
            promise.error(err);
            return;
        }
        promise.complete(doc);
    });

    return promise;

};


// Return a MailUser model based upon the defined schema
module.exports = MailUser = mongoose.model('mails_users', schema);


