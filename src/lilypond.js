/**
 * VexFlow LilyPond Backend - Parse and display LilyPond using a PegJS parser.
 * @author Daniel Ringwalt (ringw)
 */

if (! Vex.Flow.Backend) Vex.Flow.Backend = {};

/** @constructor */
Vex.Flow.Backend.LilyPond = function() {
  // Root of parsed LilyPond
  this.lilypondContext = null;
  // Array of parsed LilyPond staves, which contain multiple voices
  this.staves = new Array();
  // Array of individual voices from each stave
  this.voices = new Array();
  // Index of voice -> index of stave
  this.staveForVoice = new Array();
}

Vex.Flow.Backend.LilyPond.appearsValid = function(data) {
  if (typeof data != "string") return false;
  return data.replace(/^\s+/, "").indexOf("\\") == 0;
}

Vex.Flow.Backend.LilyPond.prototype.parse = function(data) {
  this.lilypondContext = this.parser.parse(data);
  this.valid = true;
  // XXX: assume context has a single stave at its root
  this.staves = [this.lilypondContext];
  this.voices = [];
  var staveNum = 0;
  this.staves.forEach(function(stave) {
    stave.voices.forEach(function(voice) {
      this.voices.push(voice);
      this.staveForVoice.push(staveNum);
    }, this);
    staveNum++;
  }, this);
}

Vex.Flow.Backend.LilyPond.prototype.isValid = function() { return this.valid; }

Vex.Flow.Backend.LilyPond.prototype.getNumberOfMeasures = function() {
  return this.voices[0].length - 1; // FIXME
}

Vex.Flow.Backend.LilyPond.prototype.getMeasureNumber = function(m) {
  return m+1; // FIXME
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
  if (! (match = note.match(/^([a-g]?)((b|#)*)(('|,)*)$/i)))
    throw new Vex.RERR("InvalidLilyPond",
        "Not a LilyPond note: '" + note + "'");
  var pitch = match[1].toLowerCase() || null;
  var accidentals = match[2].toLowerCase() || "n";
  if (typeof accidentals == "undefined")
    throw new Vex.RERR("InvalidLilyPond", "Bad accidentals: '"+match[2]+"'");
  var relOctave = match[4].length * (match[4][0] == "'" ? 1 : -1);
  var octave;
  if (base) {
    // Relative mode
    if (! (match = base.match(/^([a-g])(#+|b+|n+)?\/([0-9]+)/i)))
      throw new Vex.RERR("InvalidArgument", "Bad base note");
    // Use base pitch for this note if pitch implied
    if (pitch == null) pitch = match[1].toLowerCase();
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
    // Pitch required in this case
    if (pitch == null) throw new Vex.RERR("InvalidLilyPond",
                                    "Note with implied pitch requires base");
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
    if (voice[0].relative) return voice[0].relative;
    voice[0].relative = this.parseKey(voice.relative).keys;
    return voice[0].relative;
  }
  else {
    // Allow m up to "one past last measure" to go through last measure
    if (m > voice.length) throw new Vex.RERR("InvalidArgument",
                                                      "Not a measure number");
    // Ensure we have relative values for every measure up to this one
    if (m > 0 && ! ("relative" in voice[m-1]))
      this.getMeasureRelative(v, m-1);
    // Relative at start of measure m-1
    var relative = voice[m-1].relative;

    // Store absolute_keys and relative in each note for previous measure
    voice[m-1].forEach(function(n) {
      if (! n.keys || ! n.keys.length) return;
      var keyRelative = relative; // Relative to each note in chord
      n.accidentals = [];
      n.absolute_keys = n.keys.map(function(k) {
        var key = this.parseKey(k, keyRelative);
        if (k[k.length-1] == '!') console.log(k.toString() + " -> " + key.accidentals);
        if (key.accidentals == null)
          n.accidentals = null; // Decide all accidentals in note automatically
        else if (n.accidentals)
          n.accidentals.push(key.accidentals);
        keyRelative = key.keys;
        return keyRelative;
      }, this);
      // Relative for rest of notes only uses first key
      relative = n.absolute_keys[0];
    }, this);
    // Relative at start of this measure
    // Don't actually store final relative value past last measure
    if (m < voice.length) voice[m].relative = relative;
    return relative;
  }
}

/**
 * MUST be called on each measure sequentially, or bad things will happen!
 */
Vex.Flow.Backend.LilyPond.prototype.getMeasure = function(m) {
  var attrs = {};
  attrs.clef = this.staves.map(function() {return "treble"}); // FIXME
  if (m == 0) {
    // Default duration
    attrs.duration = this.voices.map(function() {return "8"});
  }
  else {
    attrs.duration = this.voices.map(function(voice) {
      var lastMeasure = voice[m-1];
      return lastMeasure[lastMeasure.length-1].duration || "8";
    });
  }
  if (! ("key" in attrs))
    attrs.key = "C";
  if (! ("time" in attrs))
    attrs.time = {num_beats: 4, beat_value: 4, soft: true};
  var measure = new Vex.Flow.Measure({time: attrs.time});
  var part = measure.getPart(0); // TODO: Multiple parts
  part.options.clef = "treble";
  part.options.key = "C"; // FIXME: key
  part.setNumberOfStaves(this.staves.length);
  part.setNumberOfVoices(this.voices.length);
  var v = 0;
  this.voices.forEach(function(lilyVoice) {
    this.getMeasureRelative(v, m+1);
    var voice = part.getVoice(v);
    voice.stave = this.staveForVoice[v];
    lilyVoice[m].forEach(function(n) {
      if (n.clef) {
        var stave = part.getStave(voice.stave);
        stave.clef = attrs.clef[voice.stave] = n.clef;
        return;
      }
      if (n.duration) {
        attrs.duration[v] = n.duration.toString();
        if (n.duration[n.duration.length-1]=='d')console.log(n);
      }
      else n.duration = attrs.duration[v];
      voice.addNote({keys: n.absolute_keys,
                     duration: attrs.duration[v],
                     accidentals: n.accidentals,
                     beam: (n.beam == "start") ? "begin" : (n.beam || null),
                     rest: (n.type == "rest")});
    });
    if (attrs.clef[voice.stave])
      part.getStave(voice.stave).clef = attrs.clef[voice.stave];
    v++;
  }, this);
  return measure;
}

Vex.Flow.Backend.LilyPond.prototype.getStaveConnectors = function() {
  // FIXME: Stave connectors for multipart music
  if (this.staves.length > 1)
    return [{type: "brace", parts: [0], system_start: true}];
  else return [];
}
