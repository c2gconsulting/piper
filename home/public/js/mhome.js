var inputReady = true;
var input = $('.form-control');
input.focus();
$('.container').on('click', function(e) {
  input.focus();
});
console.log('GOT HERE 1');
var spext = $('#feedback').html();
console.log('Field: ' + spext);


$('.pForm').on('submit', function(e) {
  e.preventDefault();
  var val = $('.form-control').val();
  if (val && val != '') {
    console.log('GOT HERE 3');
    var spext = $('#feedback').html();
    console.log('Field: ' +  spext);
    if (invalidToken(val)) {
      resetForm('The token you provided is invalid. Please copy the correct one carefully and try again');
    } else {
      $('#feedback').removeClass('text-success text-danger').addClass('text-info');
      var msg = 'Connecting to Slack...';
      $('#feedback').html(msg);

      // disable text box and submit button 
      input.disabled = true;   
    
      var xmlhttp;
      if (window.XMLHttpRequest) { // code for IE7+, Firefox, Chrome, Opera, Safari
        xmlhttp = new XMLHttpRequest();
      } else { // code for IE6, IE5
        xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
      }
      xmlhttp.onreadystatechange = function() {
          if (xmlhttp.readyState==4 && xmlhttp.responseText) {
            try {
              resp = JSON.parse(xmlhttp.responseText);
            } catch(e) {
              resp = { 'ok': false };
            }
            if (resp.ok) {
              $('#feedback').removeClass('text-info text-danger').addClass('text-success');
              var m1 = 'Connected! Attaching to ' + resp.name + '\'s account as @' + resp.bot + '......................';
              var m2 = 'Congratulations, you\'re all set! The administrator for your account is ' + resp.email;
              var m3 = 'Redirecting to Slack...';
              $('#feedback').html(m1);
              setTimeout(function() { $('#topc').append('<p class="text-success">' + m2 + '</p>'); }, 3000);
              setTimeout(function() { $('#topc').append('<p class="text-success">' + m3 + '</p>'); }, 5000);
              setTimeout(function() { window.location.href = 'http://' + resp.domain + '.slack.com/messages/@' + resp.bot; }, 8000);
            } else {
              var resp = JSON.parse(xmlhttp.responseText);
              switch (resp.error) {
                case 'existing_client':
                  var msg = resp.name + ' is already registered. Redirecting to Slack...';
                  $('#feedback').removeClass('text-success text-danger').addClass('text-info');
                  $('#feedback').html(msg);
                  setTimeout(function() { window.location.href = 'http://' + resp.domain + '.slack.com/messages/@' + resp.bot; }, 5000);
                  break;
                case 'registration_failure':
                  resetForm('Oops, something went wrong. Please wait a moment then try again'); 
                  break;
                default:
                  resetForm('This token is invalid. Please copy the correct one carefully and try again');
              }
            }
        } else {
           // resetForm('Oops, something went wrong. Please wait a moment then try again'); 
        }
      };
      xmlhttp.open("GET", "api/register?token=" + val, true);
      xmlhttp.send();
    }
  }
});

function invalidToken(token) {
  console.log('GOT HERE-> invalidtoken');
  if (token.length !== 40) return true;
  if (token.substr(0, 3) !== 'xox') return true;
  return false;
}

function resetForm(message) {
  console.log('Got here->resetForm: ' + message);
  var input = $('.form-control');
  input.val('');
  
  $('#feedback').removeClass('text-success text-info').addClass('text-danger');
  $('#feedback').html(message);
  
  // enable text box and submit button and set focus
  input.disabled = false;
  input.focus();
  
}