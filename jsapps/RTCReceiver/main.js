'use strict';

var WebSocket = require('ws'),
  $ = require('jquery-browserify'),
  Message = require('../../signalingserver/lib/CRMessage'),
  loremIpsum = require('lorem-ipsum'),
  PeerConnectionHandler = require('./PeerConnection'),
  ControlsHandler = require('./ControlsHandler'),
  argv = require('querystring').parse(window.location.search.substr(1));

function TestClient(options ) {

  this.defaults = {
    host: 'ws://' + window.location.host
  };

  this.type = 'client';
  if (argv.renderer) {
    this.type = 'renderer';
  }

  this.controlsHandler = new ControlsHandler('.video', function(arg) { console.log( 'CB: ', arg); });

  this.options = options ||  this.defaults;

  window.g = this;

  this.nick = loremIpsum({
    count: 1,
    units: 'words'
  });
  this.clientList = {};
  this.socket = new WebSocket(this.options.host);

  this.socket.onopen = this.onopen.bind(this);
  this.socket.onmessage = this.onmessage.bind(this);
  this.socket.onclose = this.onclose.bind(this);

  var servers = {
    'iceServers': [
      { 'url': 'stun:stun.l.google.com:19302' },
      { 'url': 'turn:130.206.83.161:3478' }
    ]
  };

  this.peerConnection = new PeerConnectionHandler(this.socket, servers);

  if (argv.talk) {
    this.autoTalk();
  }

}

TestClient.prototype.domShit = function() {
  var that = this;
  document.querySelector('.yournick').onblur = function(event) {
    that.nick = event.target.value;
    that.sendIntroduction();
  };
  document.querySelector('.yourmessage').addEventListener('keydown', function(e) {
    if (!e) {
      e = window.event;
    }

    // Enter is pressed
    if (e.keyCode === 13) {
      var msg = this.value;
      this.value = '';
      that.sendMessage(new Message('Application', 'RoomCustomMessage', {
        payload: {
          message: msg
        }
      }));
    }
  }, false);
};

TestClient.prototype.autoTalk = function() {
  var that = this;
  setInterval(function() {
    var lorem = loremIpsum({
      count: 1,
      units: 'sentences',
      sentenceLowerBound: 2,
      sentenceUpperBound: 7
    });
    that.sendMessage(new Message('Application', 'RoomCustomMessage', {
      payload: {
        message: lorem
      }
    }));
  }, 4000);
};

TestClient.prototype.onopen = function() {
  var data = {
    registrant: this.type
  };
  if (argv.room) {
    data.roomId = argv.room;
  }

  console.log('parameters', data);

  var m = new Message('State', 'Registration', data);
  console.log('Sending Registration');
  this.socket.send(m.toJSON());

  if (this.type === 'client') {
    this.domShit();
    this.sendIntroduction();
  } else {
    this.peerConnection.startRendererPeerConnection();
  }

};

TestClient.prototype.sendIntroduction = function(peerId) {
  var message = new Message('Application', 'RoomCustomMessage', {
    payload: {
      introduction: {
        nick: this.nick
      }
    }
  });
  if (peerId !== undefined) {
    message.setDataProp('peerIds', [peerId]);
  }
  this.send(message.toJSON());
};

TestClient.prototype.sendMessage = function(message) {
  console.log('sending: ', message.toString());
  this.send(message.toJSON());
};

TestClient.prototype.send = function(string) {
  this.socket.send(string);
};

TestClient.prototype.onmessage = function(data) {
  var message = new Message().parse(data.data);
  if (!message) {
    console.log('MessageParsingError');
    return false;
  }
  switch (message.getChannel()) {
    case 'State':
      console.log('Got: ', message.toString());
      break;
    case 'Room':
      this.roomMessageHandler(message);
      break;
    case 'Application':
      this.applicationMessageHandler(message);
      break;
    case 'Signaling':
      this.signalingMessageHandler(message);
      break;
    default:
      console.log('No messageHandler for:', message.toString());
  }
};

TestClient.prototype.onclose = function() {};

TestClient.prototype.signalingMessageHandler = function(message) {
  console.log(message.toString());
  if (message.getType() === 'Answer') {
    this.peerConnection.onAnswer(message);
  }
  if (message.getType() === 'IceCandidates') {
    this.peerConnection.gotRemoteIceMessage(message);
  }
  if (message.getType() === 'Offer') {
    this.peerConnection.onOffer(message);
  }

  console.log(message);
};

TestClient.prototype.applicationMessageHandler = function(message) {
  var payload = message.getDataProp('payload');

  if (payload.hasOwnProperty('message')) {
    var element = document.querySelector('.messages');
    var container = document.createElement('p');
    var name = document.createElement('span');
    var msg = document.createElement('span');
    var sender = payload.senderId;
    if (this.clientList.hasOwnProperty(sender)) {
      sender = this.clientList[sender];
    }
    name.innerHTML = sender + ': ';
    msg.innerHTML = payload.message;
    container.appendChild(name);
    container.appendChild(msg);
    element.appendChild(container);
    element.scrollTop = element.scrollHeight;
  }

  if (payload.hasOwnProperty('introduction') && payload.hasOwnProperty('senderId')) {
    if (!this.clientList.hasOwnProperty(payload.senderId)) {
      this.sendIntroduction(payload.senderId);
    }
    this.clientList[payload.senderId] = payload.introduction.nick;
  }

  if (payload.hasOwnProperty('serverStatus')) {
    var statusEl = $('.serverStatus');
    if (statusEl.length == 0 ){
      statusEl = $('<div class="serverStatus" />');
      $('body').append(statusEl);
    }

    var element = document.createElement('div');
    var status = payload['serverStatus'];
    for (var key in status){
      var header = document.createElement('h2');
      header.innerText = key;
      element.appendChild(header);

      var table = document.createElement('dl');
      var section = status[key];
      for (var stat in section){
        var statName = document.createElement('dt');
        statName.innerText = stat
        table.appendChild(statName);
        var statContent = document.createElement('dd');
        statContent.innerText = section[stat];
        table.appendChild(statContent);
      }
      element.appendChild(table);
    }

    statusEl.html( element );
  }

};

TestClient.prototype.roomMessageHandler = function(message) {
  if (message.getType() === 'RoomAssigned') {
    if (message.getDataProp('error') === 0) {
      this.peerId = message.getDataProp('peerId');
      this.roomId = message.getDataProp('roomId');

      var roomLink = document.createElement('a');
      roomLink.innerHTML = 'Room Id: ' + this.roomId;
      roomLink.href = window.location.protocol + '//' + window.location.host + window.location.pathname + '?room=' + this.roomId;
      document.body.appendChild(roomLink);

      this.peerConnection.initiatePeerConnection();
    }
  }
  console.log(message.toString());
};

module.exports = TestClient;
var testClient = new TestClient();