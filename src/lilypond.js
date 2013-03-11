/**
 * VexFlow LilyPond Backend - Parse and display LilyPond using a PegJS parser.
 * @author Daniel Ringwalt (ringw)
 */

if (! Vex.Flow.Backend) Vex.Flow.Backend = {};

/** @constructor */
Vex.Flow.Backend.LilyPond = function() {
  // Array of parsed LilyPond voices, which contain multiple measures
  this.voices = new Array();
  // Array of staves containing list of corresponding voice indices
  this.staves = new Array();
  // Store measures -> object of attributes
  // clef (array of staves), time, key, duration (last used duration)
  this.attributes = new Array();
}

Vex.Flow.Backend.LilyPond.appearsValid = function(data) {
  if (typeof data != "string") return false;
  return data.replace(/^\s+/, "").toLowerCase().indexOf("\\header") == 0;
}

Vex.Flow.Backend.LilyPond.prototype.parse = function(data) {
  var parsedData = this.parser.parse(data);
  this.valid = true;
  var voiceIndices = {};
  for (voice in parsedData.voices) {
    voiceIndices[voice] = this.voices.length;
    this.voices.push(parsedData.voices[voice]);
  }
  // Each voice must have the same number of measures
  var numMeasures = this.voices[0].measures.length;
  this.voices.forEach(function(v) {
    if (v.measures.length != numMeasures) {
      this.valid = false;
      throw new Vex.RERR("InvalidLilyPond", "Bad number of measures");
    }
  });
  if (! parsedData.score.staves.length) {
    this.valid = false;
    throw new Vex.RERR("InvalidLilyPond", "No staves in score");
  }
  this.staves = parsedData.score.staves.map(function(voiceNames) {
    if (! voiceNames.length) {
      this.valid = false;
      throw new Vex.RERR("InvalidLilyPond",
          "Stave in LilyPond score must contain at least one voice");
    }
    return voiceNames.map(function(name) {
      if (typeof voiceIndices[name] != "number") {
        this.valid = false;
        throw new Vex.RERR("InvalidLilyPond", "?");
      }
      return voiceIndices[name];
    })
  });
  // Calculate relative for each voice in the first measure
  for (var v = 0; v < this.voices.length; v++)
    this.getMeasureRelative(v, 0);
}

Vex.Flow.Backend.LilyPond.prototype.isValid = function() { return this.valid; }

Vex.Flow.Backend.LilyPond.prototype.getNumberOfMeasures = function() {
  return this.voices[0].measures.length;
}

Vex.Flow.Backend.LilyPond.prototype.getMeasureNumber = function(m) {
  return this.voices[0].measures[m].measure;
}

/** Return an object of the form {keys:"c/4", accidentals:"n"}
 ** null accidentals implies accidentals should be decided automatically,
 ** otherwise accidentals should be forced
 **/
Vex.Flow.Backend.LilyPond.prototype.parseKey = function(note, base) {
  var forceAccidental = false;
  if (note.match(/(!|\?)$/)) {
    forceAccidental = true;
    note = note.replace(/(!|\?)$/, "");
  }
  var match;
  // Parse LilyPond note
  if (! (match = note.match(/^([a-g])(([ei]s)*)(('|,)*)$/i)))
    throw new Vex.RERR("InvalidLilyPond",
        "Not a LilyPond note: '" + note + "'");
  var pitch = match[1].toLowerCase();
  var accidentals = {"": "n", es: "b", eses: "bb", is: "#", isis: "##"
      }[match[2].toLowerCase()];
  if (typeof accidentals == "undefined")
    throw new Vex.RERR("InvalidLilyPond", "Bad accidentals: '"+match[1]+"'");
  var relOctave = match[4].length * (match[4][0] == "'" ? 1 : -1);
  var octave;
  if (base) {
    // Relative mode
    if (! (match = base.match(/^([a-g])(#+|b+|n+)?\/([0-9]+)/i)))
      throw new Vex.RERR("InvalidArgument", "Bad base note");
    // Base pitch to integer 0-6 (for c-b); 97 is char code for "a"
    var basePitchNum = (match[1].toLowerCase().charCodeAt() - 97 - 2 + 7) % 7;
    var baseOctave = parseInt(match[3]);
    var pitchNum = (pitch.charCodeAt() - 97 - 2 + 7) % 7;
    octave = baseOctave + relOctave;
    // Adjust octave so that new pitch is closer to base pitch
    if (pitchNum - basePitchNum >= 4) octave--;
    else if (pitchNum - basePitchNum <= -4) octave++;
  }
  else {
    // Absolute mode; default to octave "3"
    octave = 3 + relOctave;
  }
  return {keys: pitch + accidentals + "/" + octave.toString(),
          accidentals: forceAccidental ? accidentals : null};
}

Vex.Flow.Backend.LilyPond.prototype.getMeasureRelative = function(v, m) {
  // Check if voice actually uses relative pitches
  var voice = this.voices[v];
  if (typeof voice.relative != "string") return null;

  if (m == 0) {
    voice.measures[0].relative = this.parseKey(voice.relative).keys;
    return voice.measures[0].relative;
  }
  else {
    // Allow m up to "one past last measure" to go through last measure
    if (m > voice.measures.length) throw new Vex.RERR("InvalidArgument",
                                                      "Not a measure number");
    // Ensure we have relative values for every measure up to this one
    if (m > 0 && ! ("relative" in voice.measures[m-1]))
      this.getMeasureRelative(v, m-1);
    // Relative at start of measure m-1
    var relative = voice.measures[m-1].relative;

    // Store absolute_keys and relative in each note for previous measure
    voice.measures[m-1].notes.forEach(function(n) {
      if (! n.keys || ! n.keys.length) return;
      var keyRelative = relative; // Relative to each note in chord
      n.accidentals = [];
      n.absolute_keys = n.keys.map(function(k) {
        var key = this.parseKey(k, keyRelative);
        n.accidentals.push(key.accidentals);
        keyRelative = key.keys;
        return keyRelative;
      }, this);
      // Relative for rest of notes only uses first key
      relative = n.absolute_keys[0];
    }, this);
    // Relative at start of this measure
    // Don't actually store final relative value past last measure
    if (m < voice.measures.length) voice.measures[m].relative = relative;
    return relative;
  }
}
Vex.Flow.Backend.LilyPond.prototype.getMeasure = function(m) {
  var attrs;
  if (! (m in this.attributes)) {
    attrs = this.attributes[m] = Vex.Merge({}, this.attributes[m-1] || {});
    // Force deep copy of clefs/duration
    if (attrs.clef) attrs.clef = attrs.clef.slice();
    if (attrs.duration) attrs.duration = attrs.duration.slice();
  }
  else attrs = this.attributes[m];
  if (! ("clef" in attrs))
    attrs.clef = this.staves.map(function() {return "treble"});
  if (! ("duration" in attrs))
    attrs.duration = this.voices.map(function() {return "8"});
  if (! ("key" in attrs))
    attrs.key = "C";
  if (! ("time" in attrs))
    attrs.time = {num_beats: 4, beat_value: 4, soft: true};
  var measure = new Vex.Flow.Measure({time: attrs.time});
  var part = measure.getPart(0); // TODO: Multiple parts
  part.options.clef = "treble";
  part.setNumberOfStaves(this.staves.length);
  // Array of voice number -> stave number
  var voicesToStaves = [];
  var s = 0;
  this.staves.forEach(function(voiceNumbers) {
    voiceNumbers.forEach(function(v) { voicesToStaves[v] = s; });
    s++;
  });
  part.setNumberOfVoices(this.voices.length);
  var v = 0;
  this.voices.forEach(function(lilyVoice) {
    this.getMeasureRelative(v, m+1);
    var voice = part.getVoice(v);
    voice.stave = voicesToStaves[v];
    lilyVoice.measures[m].notes.forEach(function(n) {
      if (n.clef) {
        var stave = part.getStave(voice.stave);
        stave.clef = attrs.clef[voice.stave] = n.clef;
        return;
      }
      if (n.duration) attrs.duration[v] = n.duration.toString();
      voice.addNote({keys: n.absolute_keys, duration: attrs.duration[v],
                     beam: (n.beam == "start") ? "begin" : (n.beam || null),
                     rest: (n.type == "rest")});
    });
    if (attrs.clef[voice.stave])
      part.getStave(voice.stave).clef = attrs.clef[voice.stave];
    v++;
  }, this);
  return measure;
}

Vex.Flow.Backend.LilyPond.prototype.getStaveConnectors = function(){return []}
