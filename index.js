var context = new require('rabbit.js').createContext('amqp://localhost');

var pub = context.socket('PUB', {routing: 'topic'});
var sub = context.socket('SUB', {routing: 'topic'});
sub.pipe(process.stdout);

sub.connect('piper.events.out', 'mobilizr.CHITCHAT', function() {
  // Make sure we're listening before sending anything
  pub.connect('piper.events.in', function() {
    pub.publish('new.trigger', JSON.stringify({username: "Fiver"}));
  });
});

//sub.connect('piper.events.out', 'people.create', function() {
  // Make sure we're listening before sending anything
//  pub.connect('piper.events.out', function() {
//    pub.publish('people.create', JSON.stringify({username: "Sixer"}));
//  });
//});