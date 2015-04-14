var mongoose = require('mongoose');

// Create a new schema for our tweet data
var schema = new mongoose.Schema({
    first_name      : String
  , last_name       : String
  , full_name       : String
  , email           : String
  , phone           : String
  , avatar          : String 
  , active          : Boolean
  , createdAt       : { type: Date, default: Date.now }
  , slackProfiles   : [{
      id            : String
    , name          : String
    , clientHandle  : String
    , is_admin      : String
  }]
  , preferences     : [{
      pKey   : String
    , pValue : String
  }]
});

// Static methods
schema.statics.getUserByID = function(userId, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  User.findOne({ '_id' : userId }).exec( function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
  
  return promise;

}

schema.statics.getUserByEmail = function(email, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  User.findOne({ 'email' : email }).exec( function(err, doc) {
     if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
 
  return promise;

}

schema.statics.getUserBySlackNameAndClient = function(name, client, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  User.findOne({ 'slackProfiles.name' : name, 'slackProfiles.clientHandle' : client }).exec( function(err, doc) {
     if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
 
  return promise;

}

schema.statics.getUserBySlackID = function(userId, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  User.findOne({ 'slackProfiles.id' : userId }).exec( function(err, doc) {
     if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
 
  return promise;

}

schema.statics.getUsersByClient = function(client, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  User.find({ 'slackProfiles.clientHandle' : client }).exec( function(err, docs) {
     if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
 
  return promise;

}


// Return a User model based upon the defined schema
module.exports = User = mongoose.model('users', schema);


