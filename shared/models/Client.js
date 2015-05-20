var mongoose = require('mongoose');

// Create a new schema for our data
var schema = new mongoose.Schema({
    name                : String
  , slackHandle         : String
  , slackToken          : String
  , botAlias            : String
  , adminContact        : String
  , adminEmail          : String
  , isActive            : Boolean
});


// Static methods
schema.statics.getClientByID = function(clientId, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Client.findOne({ '_id' : clientId }).exec( function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
  
  return promise;

};

schema.statics.getClientByName = function(name, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Client.findOne({ 'name' : name }).exec( function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
  
  return promise;

};

schema.statics.getClientByHandle = function(handle, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Client.findOne({ 'slackHandle' : handle }).exec( function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
  
  return promise;

};

schema.statics.getAllClients = function(callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Client.find({}).exec( function(err, docs) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
  
  return promise;

};


schema.statics.removeClient = function(clientId, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Client.remove({ '_id': clientId }, function(err, docs) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
  
  return promise;

};


// Return an Client model based upon the defined schema
module.exports = Client = mongoose.model('clients', schema);


