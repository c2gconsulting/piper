var when = require('when');

/*
when.iterate(function(x) {
    console.log('f: ' + x);
    return x+1;
}, function(x) {
    // Stop when x >= 100000000000
    console.log('predicate: ' + x);
    return x >= 10;
}, function(x) {
    console.log('handler: ' + x);
}, 0).done();
*/

var stop = false;

var mlist = [1,2,3,4,5,6,7,8];

when.unfold(function(mlist) {
    console.log('f: ' + mlist[0]);
    return [mlist[0], mlist.slice(1)];
}, function(remaining) {
    // Stop when x >= 100000000000
    console.log('predicate: ' + JSON.stringify(remaining));
    return remaining[0] > 5 || stop;
}, function(item) {
	if (item === 3) stop = true;
    console.log('handler: ' + item);
}, mlist).done();