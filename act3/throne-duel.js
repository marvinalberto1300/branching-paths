/* ============================================================
   THRONE DUEL — Turn-based boss fight for Act III
   Party is passed via URL query string: ?party=brann,elya,harold,maven
   King is always present. Valid companion ids: brann, elya, harold, maven
   ============================================================ */
(function () {

  // ----------------------------------------------------------
  // ENDINGS
  // ----------------------------------------------------------
  var ENDINGS = {
    trial:     'act3_ending_trial.html',
    vigilant:  'act3_ending_vigilant.html',
    traitor:   'act3_ending_traitor.html',
    sad_trial: 'act3_ending_sad_trial.html',
    iron_fist: 'act3_ending_iron_fist.html',
    gameover:  'act3_gameover.html'
  };

  // ----------------------------------------------------------
  // CHARACTER TEMPLATES
  // ----------------------------------------------------------
  var TEMPLATES = {
    king: {
      id: 'king', name: 'The King', role: 'Crownless King',
      maxHearts: 5, baseCrit: 15, weapon: 'Sword'
    },
    harold: {
      id: 'harold', name: 'Harold', role: 'Knight',
      maxHearts: 5, baseCrit: 10, weapon: 'Flail'
    },
    brann: {
      id: 'brann', name: 'Brann', role: 'Cleric',
      maxHearts: 3, baseCrit: 5, weapon: 'Staff'
    },
    maven: {
      id: 'maven', name: 'Maven', role: 'Mage',
      maxHearts: 4, baseCrit: 15, weapon: 'Forbidden Tome'
    },
    elya: {
      id: 'elya', name: 'Elya', role: 'Archer',
      maxHearts: 2, baseCrit: 5, weapon: 'Bow'
    }
  };

  // Turn order
  var TURN_ORDER = ['king', 'harold', 'brann', 'maven', 'elya'];

  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------
  var S = {
    // Boss
    boss: {
      hp: 20, maxHp: 20, phase: 1,
      enraged: false, enragedTarget: null,
      skipChance: 0   // 0.0–1.0, reset after each round
    },
    party: [],          // array of live character objects
    talkCount: 0,       // total talk actions across all characters
    mageTalkCount: 0,   // maven-specific talk count
    mageBetrayed: false,
    betrayalQueue: [],  // remaining targets for mage betrayal order
    round: 1,
    lastHitter: null,   // id of last character to damage boss
    log: [],            // newest first
    // Per-round action queue
    actionSlots: [],    // ordered char ids to act this round
    slotIndex: 0,       // which slot we're currently choosing for
    actionQueue: [],    // {charId, action, targetId}
    armedWell: false,
    bannersRallied: false,
    mode: 'easy',
    gameState: 'selecting' // 'selecting' | 'summary' | 'end'
  };

  // ----------------------------------------------------------
  // INITIALISE
  // ----------------------------------------------------------
  function init() {
    var params = new URLSearchParams(window.location.search);
    var raw = params.get('party') || '';
    var armedWell = params.get('armedWell') === '1';
    var bannersRallied = params.get('bannersRallied') === '1';
    var modeParam = params.get('difficulty') || params.get('mode');
    S.armedWell = armedWell;
    S.bannersRallied = bannersRallied;
    var ids = raw ? raw.split(',').filter(function (id) { return TEMPLATES[id]; }) : [];
    S.mode = (modeParam === 'hard' || modeParam === 'easy')
      ? modeParam
      : (ids.indexOf('brann') !== -1 ? 'easy' : 'hard');

    // King always first
    var members = ['king'].concat(ids);
    S.party = members.map(function (id) {
      var t = TEMPLATES[id];
      var startHearts = t.maxHearts + (armedWell ? 1 : 0);
      return {
        id: t.id, name: t.name, role: t.role,
        weapon: t.weapon,
        hearts: startHearts, maxHearts: startHearts,
        baseCrit: t.baseCrit,
        critBonus: 0,   // stacks from King's Rally
        boosted: false, // guaranteed crit next attack (Inspire)
        aimed: false,   // Elya: guaranteed max damage next attack
        skipTurns: 0,   // rounds to skip
        healing: null,  // {turnsLeft, targetId} for Brann's deep Heal
        protected: false,    // Mage protection spell
        escorted: false,     // acts twice this round (from Harold's Escort)
        lookoutFor: null,    // char id Elya is watching
        defendedBy: null     // char id defending this char (Harold)
      };
    });

    // Mage betrayal order: brann → elya → king → harold (only those present)
    S.betrayalQueue = ['brann', 'elya', 'king', 'harold'].filter(function (id) {
      return S.party.some(function (c) { return c.id === id; });
    });

    if (armedWell) {
      addLog('Your warband was armed well. Every available ally enters with +1 heart.');
    }

    if (bannersRallied) {
      addLog('Banners Rallied: allied pressure will chip away at the Usurper each round.');
    }

    addLog('Battle mode: ' + (S.mode === 'hard' ? 'Hard' : 'Easy') + '.');

    renderAll();
    startRound();
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------
  function getChar(id) {
    return S.party.find(function (c) { return c.id === id; }) || null;
  }

  function livingParty() {
    return S.party.filter(function (c) {
      return c.hearts > 0 && !(c.id === 'maven' && S.mageBetrayed);
    });
  }

  function deadParty() {
    return S.party.filter(function (c) { return c.hearts <= 0; });
  }

  function statusOf(c) {
    if (c.hearts <= 0) return 'Dead';
    if (c.hearts === 1) return 'Fatal';
    if (c.hearts < c.maxHearts) return 'Wounded';
    return 'Healthy';
  }

  function iconVariantFromStatus(status) {
    if (status === 'Dead') return 'deceased';
    if (status === 'Fatal') return 'critical';
    if (status === 'Wounded') return 'injured';
    return 'healthy';
  }

  function iconPathFor(c, status) {
    return '../final-battle-icons/' + c.id + '-' + iconVariantFromStatus(status) + '.png';
  }

  function bossPhase() {
    var hpRatio = S.boss.hp / S.boss.maxHp;
    if (hpRatio > 0.5) return 1;
    if (hpRatio > 0.25) return 2;
    return 3;
  }

  function bossDisplayName() {
    return bossPhase() === 1 ? 'Usurpers Army' : 'The Usurper';
  }

  function pushFlavorText() {
    var lines = [
      'Spears slam against shields as you force a step deeper into the throne hall.',
      'The hold narrows with bodies and banners while your line grinds forward.',
      'Steel rings against stone as your party carves a path toward the dais.',
      'Archers on the gallery rain fire while you push through the choking crush.'
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  function bossAttackForPhase(mode, phase) {
    var r = roll100();

    if (mode === 'hard') {
      if (phase === 1) {
        return r <= 85 ? { dmg: 1, type: 'hit' } : { dmg: 0, type: 'miss' };
      }
      if (phase === 2) {
        if (r <= 75) return { dmg: 1, type: 'hit' };
        if (r <= 90) return { dmg: 0, type: 'miss' };
        return { dmg: 1, type: 'heavy-hit' };
      }
      // User-provided hard-phase-3 percentages add to 95; remaining 5% is treated as miss.
      if (r <= 65) return { dmg: 1, type: 'hit' };
      if (r <= 80) return { dmg: 0, type: 'miss' };
      if (r <= 95) return { dmg: 2, type: 'critical' };
      return { dmg: 0, type: 'miss' };
    }

    // Easy mode
    if (phase === 1) {
      return r <= 65 ? { dmg: 1, type: 'hit' } : { dmg: 0, type: 'miss' };
    }
    if (phase === 2) {
      return r <= 70 ? { dmg: 1, type: 'hit' } : { dmg: 0, type: 'miss' };
    }
    if (r <= 85) return { dmg: 1, type: 'hit' };
    if (r <= 95) return { dmg: 0, type: 'miss' };
    return { dmg: 2, type: 'critical' };
  }

  function roll100() {
    return Math.floor(Math.random() * 100) + 1;
  }

  function addLog(text) {
    S.log.unshift(text);
    if (S.log.length > 10) S.log.pop();
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function damageChar(c, amount) {
    if (amount <= 0) return;
    if (c.protected) {
      if (roll100() <= 10) {
        addLog('\u2734 ' + c.name + '\u2019s protection holds \u2014 no damage!');
        c.protected = false;
        return;
      }
      c.protected = false;
    }
    c.hearts = clamp(c.hearts - amount, 0, c.maxHearts);
    if (c.hearts <= 0) {
      addLog('\u2764 ' + c.name + ' has fallen!');
    }
  }

  function damageBoss(amount, sourceId) {
    S.boss.hp = Math.max(0, S.boss.hp - amount);
    S.lastHitter = sourceId;
  }

  function healChar(c, amount) {
    c.hearts = clamp(c.hearts + amount, 0, c.maxHearts);
  }

  // ----------------------------------------------------------
  // ROUND MANAGEMENT
  // ----------------------------------------------------------
  function startRound() {
    S.actionQueue = [];
    S.slotIndex = 0;

    applyBannersPressure();
    if (checkWin()) return;

    // Build action slots in turn order, respecting skip and escort
    var slots = [];
    TURN_ORDER.forEach(function (id) {
      var c = getChar(id);
      if (!c) return;
      if (c.hearts <= 0) return;
      if (c.id === 'maven' && S.mageBetrayed) return; // maven acts as enemy

      if (c.skipTurns > 0) {
        c.skipTurns--;
        // Still fire pending heal check even when skipping
        return;
      }
      slots.push(id);
      if (c.escorted) {
        slots.push(id); // acts twice
        c.escorted = false;
      }
    });

    S.actionSlots = slots;

    if (slots.length === 0) {
      addLog('Your party is too spent to act this round.');
      resolveBoss();
      return;
    }

    S.gameState = 'selecting';
    promptNextSlot();
  }

  function promptNextSlot() {
    if (S.slotIndex >= S.actionSlots.length) {
      // All characters have chosen — execute
      executeActionQueue();
      return;
    }
    var charId = S.actionSlots[S.slotIndex];
    renderActionPanel(getChar(charId));
    renderPartyCards(charId);
  }

  function submitAction(action, targetId) {
    S.actionQueue.push({ charId: S.actionSlots[S.slotIndex], action: action, targetId: targetId || null });
    S.slotIndex++;
    promptNextSlot();
  }

  // ----------------------------------------------------------
  // EXECUTE PARTY ACTIONS
  // ----------------------------------------------------------
  function executeActionQueue() {
    S.actionQueue.forEach(function (act) {
      var c = getChar(act.charId);
      if (!c || c.hearts <= 0) return;
      resolveAction(c, act.action, act.targetId);
      if (checkWin()) return;
    });

    // Mage betrayal strike (once per round, before boss)
    if (S.mageBetrayed) {
      var maven = getChar('maven');
      if (maven && maven.hearts > 0) {
        mageBetrayal();
      }
    }

    // Advance Brann's deep heal
    S.party.forEach(function (c) {
      if (!c.healing) return;
      c.healing.turnsLeft--;
      if (c.healing.turnsLeft <= 0) {
        var target = getChar(c.healing.targetId);
        if (target && target.hearts > 0) {
          healChar(target, 2);
          addLog('\uD83C\uDF3F Brann\u2019s prayer completes \u2014 ' + target.name + ' +2 hearts.');
        }
        c.healing = null;
      }
    });

    resolveBoss();
  }

  function resolveAction(c, action, targetId) {
    var target = targetId ? getChar(targetId) : null;

    switch (action) {
      // KING
      case 'king_attack':   kingAttack(c);            break;
      case 'king_inspire':  kingInspire(c, target);   break;
      case 'king_rally':    kingRally(c);              break;
      case 'king_talk':     doTalk(c);                 break;
      // HAROLD
      case 'harold_attack': haroldAttack(c);           break;
      case 'harold_defend': haroldDefend(c, target);   break;
      case 'harold_escort': haroldEscort(c, target);   break;
      case 'harold_talk':   doTalk(c);                 break;
      // BRANN
      case 'brann_attack':  brannAttack(c);            break;
      case 'brann_mend':    brannMend(c, target);      break;
      case 'brann_heal':    brannHeal(c, target);      break;
      case 'brann_talk':    doTalk(c);                 break;
      // MAVEN
      case 'maven_attack':  mavenAttack(c);            break;
      case 'maven_revive':  mavenRevive(c, target);    break;
      case 'maven_protect': mavenProtect(c, target);   break;
      case 'maven_talk':    doTalk(c);                 break;
      // ELYA
      case 'elya_attack':   elyaAttack(c);             break;
      case 'elya_aim':      elyaAim(c);                break;
      case 'elya_lookout':  elyaLookout(c, target);    break;
      case 'elya_talk':     doTalk(c);                 break;
    }
  }

  // ----------------------------------------------------------
  // KING ACTIONS
  // ----------------------------------------------------------
  function kingAttack(c) {
    var crit = c.baseCrit + c.critBonus;
    var dmg;
    if (c.boosted) {
      dmg = 2; c.boosted = false;
      addLog('\u2694 The King strikes with inspired fury \u2014 CRITICAL \u22122!');
    } else if (roll100() <= crit) {
      dmg = 2;
      addLog('\u2694 The King\u2019s blade bites deep \u2014 CRITICAL \u22122!');
    } else {
      dmg = 1;
      addLog('\u2694 The King strikes \u2014 hit \u22121.');
    }
    damageBoss(dmg, 'king');
  }

  function kingInspire(c, target) {
    if (!target || target.hearts <= 0) return;
    target.boosted = true;
    addLog('\u2728 The King inspires ' + target.name + ' \u2014 their next attack will strike true.');
  }

  function kingRally(c) {
    var living = livingParty();
    living.forEach(function (p) { p.critBonus += 5; });
    addLog('\uD83D\uDCE3 The King rallies all \u2014 party gains +5% crit chance! (' + living.length + ' members)');
  }

  // ----------------------------------------------------------
  // HAROLD ACTIONS
  // ----------------------------------------------------------
  function haroldAttack(c) {
    var crit = c.baseCrit + c.critBonus;
    var r = roll100();
    var dmg;
    if (c.boosted) {
      dmg = 2; c.boosted = false;
      addLog('\uD83D\uDD31 Harold swings with blessed fury \u2014 CRITICAL \u22122!');
    } else if (r <= crit) {
      dmg = 2;
      addLog('\uD83D\uDD31 Harold\u2019s flail crushes through \u2014 CRITICAL \u22122!');
    } else if (r <= 95) {
      dmg = 1;
      addLog('\uD83D\uDD31 Harold strikes \u2014 hit \u22121.');
    } else {
      dmg = 0;
      addLog('\uD83D\uDD31 Harold\u2019s flail glances wide \u2014 miss!');
    }
    if (dmg > 0) damageBoss(dmg, 'harold');
  }

  function haroldDefend(c, target) {
    if (!target || target.hearts <= 0) return;
    target.defendedBy = 'harold';
    addLog('\uD83D\uDEE1 Harold stands guard over ' + target.name + ' this round.');
  }

  function haroldEscort(c, target) {
    if (!target || target.hearts <= 0) return;
    target.escorted = true;
    addLog('\uD83E\uDD1D Harold escorts ' + target.name + ' into position \u2014 they act twice next round.');
  }

  // ----------------------------------------------------------
  // BRANN ACTIONS
  // ----------------------------------------------------------
  function brannAttack(c) {
    var crit = c.baseCrit + c.critBonus;
    var r = roll100();
    var dmg;
    if (c.boosted) {
      dmg = 1; c.boosted = false;
      addLog('\uD83C\uDF3F Brann\u2019s staff flares with divine light \u2014 hit \u22121!');
    } else if (r <= crit) {
      dmg = 1;
      addLog('\uD83C\uDF3F Brann strikes with surprising force \u2014 crit \u22121!');
    } else if (r <= 75) {
      dmg = 1;
      addLog('\uD83C\uDF3F Brann strikes \u2014 hit \u22121.');
    } else {
      dmg = 0;
      addLog('\uD83C\uDF3F Brann\u2019s staff swings wide \u2014 miss!');
    }
    if (dmg > 0) damageBoss(dmg, 'brann');
  }

  function brannMend(c, target) {
    if (!target || target.hearts <= 0) return;
    healChar(target, 1);
    addLog('\uD83C\uDF3F Brann mends ' + target.name + '\u2019s wounds \u2014 +1 heart.');
  }

  function brannHeal(c, target) {
    if (!target || target.hearts <= 0) return;
    c.skipTurns = 1;
    c.healing = { turnsLeft: 1, targetId: target.id };
    addLog('\uD83C\uDF3F Brann begins a deep healing prayer for ' + target.name + '\u2026 (+2 hearts next round)');
  }

  // ----------------------------------------------------------
  // MAVEN ACTIONS
  // ----------------------------------------------------------
  function mavenAttack(c) {
    var r = roll100();
    var dmg;
    if (c.boosted) {
      dmg = 3; c.boosted = false;
      addLog('\uD83D\uDCD6 Maven channels forbidden power \u2014 MEGA CRIT \u22123!');
    } else if (r <= 5) {
      dmg = 3;
      addLog('\uD83D\uDCD6 Maven\u2019s tome blazes uncontrollably \u2014 MEGA CRIT \u22123!');
    } else if (r <= 15) {
      dmg = 2;
      addLog('\uD83D\uDCD6 Maven unleashes a devastating spell \u2014 CRITICAL \u22122!');
    } else if (r <= 80) {
      dmg = 1;
      addLog('\uD83D\uDCD6 Maven\u2019s spell strikes \u2014 hit \u22121.');
    } else {
      dmg = 0;
      addLog('\uD83D\uDCD6 Maven\u2019s spell dissipates \u2014 miss!');
    }
    if (dmg > 0) damageBoss(dmg, 'maven');
  }

  function mavenRevive(c, target) {
    if (!target) return;
    target.hearts = 1;
    addLog('\uD83D\uDCD6 Maven weaves a revival spell \u2014 ' + target.name + ' rises with 1 heart!');
  }

  function mavenProtect(c, target) {
    if (!target || target.hearts <= 0) return;
    target.protected = true;
    c.skipTurns = 1;
    addLog('\uD83D\uDCD6 Maven casts a protective ward over ' + target.name + '.');
  }

  function mageBetrayal() {
    if (S.betrayalQueue.length === 0) {
      // Rebuild queue with still-living targets
      S.betrayalQueue = ['brann', 'elya', 'king', 'harold'].filter(function (id) {
        var c = getChar(id);
        return c && c.hearts > 0;
      });
      if (S.betrayalQueue.length === 0) return;
    }
    var targetId = S.betrayalQueue.shift();
    var target = getChar(targetId);
    if (!target || target.hearts <= 0) {
      // Skip dead, try next
      mageBetrayal();
      return;
    }
    damageChar(target, 1);
    addLog('\uD83D\uDCD6 Maven\u2019s forbidden magic lashes at ' + target.name + ' \u2014 \u22121 heart!');
  }

  // ----------------------------------------------------------
  // ELYA ACTIONS
  // ----------------------------------------------------------
  function elyaAttack(c) {
    var dmg;
    if (c.boosted || c.aimed) {
      dmg = 3; c.boosted = false; c.aimed = false;
      addLog('\uD83C\uDFF9 Elya\u2019s arrow flies true \u2014 BULLSEYE \u22123!');
    } else {
      var r = roll100();
      if (r === 1) {
        dmg = 3;
        addLog('\uD83C\uDFF9 Elya scores a perfect BULLSEYE \u2014 \u22123!');
      } else if (r <= 5) {
        dmg = 2;
        addLog('\uD83C\uDFF9 Elya lands a clean shot \u2014 \u22122!');
      } else if (r <= 40) {
        dmg = 1;
        addLog('\uD83C\uDFF9 Elya\u2019s arrow grazes through \u2014 hit \u22121.');
      } else {
        dmg = 0;
        addLog('\uD83C\uDFF9 Elya\u2019s shot goes wide \u2014 miss!');
      }
    }
    if (dmg > 0) damageBoss(dmg, 'elya');
  }

  function elyaAim(c) {
    c.aimed = true;
    addLog('\uD83C\uDFF9 Elya takes careful aim \u2014 next attack is guaranteed max damage.');
  }

  function elyaLookout(c, target) {
    if (!target || target.hearts <= 0) return;
    c.lookoutFor = target.id;
    addLog('\uD83C\uDFF9 Elya watches over ' + target.name + ' \u2014 any attack on them will cost the Usurper.');
  }

  // ----------------------------------------------------------
  // TALK
  // ----------------------------------------------------------
  function doTalk(c) {
    S.talkCount++;
    // Reset boss skip chance from previous talk before applying new one
    S.boss.skipChance = 0;
    S.boss.enraged = false;
    S.boss.enragedTarget = null;

    if (c.id === 'king') {
      S.boss.enraged = true;
      S.boss.enragedTarget = 'king';
      addLog('\uD83D\uDCAC The King speaks. The Usurper\u2019s eyes harden \u2014 ENRAGED, targeting King! (' + S.talkCount + '/10)');
    } else if (c.id === 'elya') {
      S.boss.enraged = true;
      S.boss.enragedTarget = 'elya';
      addLog('\uD83D\uDCAC Elya speaks. The Usurper\u2019s face darkens \u2014 ENRAGED, targeting Elya! (' + S.talkCount + '/10)');
    } else if (c.id === 'harold') {
      S.boss.skipChance = 0.5;
      addLog('\uD83D\uDCAC Harold speaks with the authority of iron. The Usurper pauses \u2014 50% chance he won\u2019t attack. (' + S.talkCount + '/10)');
    } else if (c.id === 'brann') {
      S.boss.skipChance = 0.25;
      addLog('\uD83D\uDCAC Brann\u2019s voice is calm in the chaos. The Usurper hesitates \u2014 25% chance he won\u2019t attack. (' + S.talkCount + '/10)');
    } else if (c.id === 'maven') {
      S.mageTalkCount++;
      if (S.mageTalkCount >= 3 && !S.mageBetrayed) {
        S.mageBetrayed = true;
        S.betrayalQueue = ['brann', 'elya', 'king', 'harold'].filter(function (id) {
          var ch = getChar(id);
          return ch && ch.hearts > 0;
        });
        addLog('\u26A0 Maven\u2019s eyes go cold. The forbidden tome turns against your party! (' + S.talkCount + '/10)');
      } else {
        addLog('\uD83D\uDCAC Maven\u2019s words carry a dark edge. The Usurper is unsettled. (' + S.talkCount + '/10) \u26A0 Maven: ' + S.mageTalkCount + '/3 before betrayal.');
      }
    }
  }

  // ----------------------------------------------------------
  // BOSS ATTACK
  // ----------------------------------------------------------
  function resolveBoss() {
    if (checkWin()) return;

    var living = livingParty();
    if (living.length === 0) { endGame('gameover'); return; }

    var phase = bossPhase();
    var bossName = bossDisplayName();

    if (phase === 1) {
      addLog('\u2694 ' + pushFlavorText());
    }

    // Skip check
    if (S.boss.skipChance > 0 && Math.random() < S.boss.skipChance) {
      addLog('\u2696 ' + bossName + ' falters for a heartbeat, the words ringing in the hall.');
      S.boss.skipChance = 0;
      afterBossActs();
      return;
    }
    S.boss.skipChance = 0;

    // Pick target
    var target;
    if (S.boss.enraged && S.boss.enragedTarget) {
      var enragedChar = getChar(S.boss.enragedTarget);
      target = (enragedChar && enragedChar.hearts > 0) ? enragedChar
               : living[Math.floor(Math.random() * living.length)];
      S.boss.enraged = false;
      S.boss.enragedTarget = null;
    } else {
      target = living[Math.floor(Math.random() * living.length)];
    }

    var attack = bossAttackForPhase(S.mode, phase);
    var dmg = attack.dmg;

    // Harold defending?
    if (target.defendedBy === 'harold') {
      var harold = getChar('harold');
      target.defendedBy = null;
      if (harold && harold.hearts > 0 && dmg > 0) {
        damageChar(harold, 1);
        dmg = Math.max(0, dmg - 1);
        addLog('\uD83D\uDEE1 Harold intercepts the blow for ' + target.name + '! Harold \u22121 heart' + (dmg > 0 ? ', ' + target.name + ' \u2212' + dmg + ' heart' + (dmg > 1 ? 's' : '') : ' (full block)') + '.');
      }
    } else if (target.defendedBy) {
      target.defendedBy = null;
    }

    // Elya lookout?
    var elya = getChar('elya');
    if (elya && elya.hearts > 0 && elya.lookoutFor === target.id && dmg > 0) {
      elya.lookoutFor = null;
      damageBoss(1, 'elya');
      addLog('\uD83C\uDFF9 Elya punishes the attack on ' + target.name + ' \u2014 boss \u22121!');
    } else if (elya) {
      elya.lookoutFor = null;
    }

    if (dmg > 0) {
      if (phase === 1) {
        addLog('\uD83D\uDEE1 ' + target.name + ' is hit by the press of the army while pushing the hold \u2014 \u2212' + dmg + ' heart' + (dmg > 1 ? 's' : '') + '!');
      } else if (attack.type === 'critical') {
        addLog('\uD83D\uDC80 ' + bossName + ' lands a brutal strike on ' + target.name + ' \u2014 \u2212' + dmg + ' hearts!');
      } else if (attack.type === 'heavy-hit') {
        addLog('\uD83D\uDC80 ' + bossName + ' forces through guard and wounds ' + target.name + ' \u2014 \u22121 heart.');
      } else {
        addLog('\uD83D\uDC80 ' + bossName + ' strikes ' + target.name + ' \u2014 \u2212' + dmg + ' heart' + (dmg > 1 ? 's' : '') + '!');
      }
      damageChar(target, dmg);
    } else {
      if (phase === 1) {
        addLog('\uD83D\uDEE1 The army surge breaks against your line \u2014 no damage this exchange.');
      } else {
        addLog('\uD83D\uDC80 ' + bossName + ' swings \u2014 the blow lands wide!');
      }
    }

    afterBossActs();
  }

  function afterBossActs() {
    var prevPhase = S.boss.phase;
    S.boss.phase = bossPhase();
    if (checkWin()) return;

    if (S.boss.phase !== prevPhase) {
      if (S.boss.phase === 2) {
        addLog('--- Phase 2 begins. The line breaks through the hold. The Usurper steps forward. ---');
      } else {
        addLog('--- Phase 3 begins. The Usurper is cornered and fights with killing intent. ---');
      }
    }

    S.round++;
    S.gameState = 'summary';
    renderAll();
    renderSummaryPanel();
  }

  // ----------------------------------------------------------
  // WIN / LOSS
  // ----------------------------------------------------------
  function checkWin() {
    var king = getChar('king');
    if (!king || king.hearts <= 0) { endGame('gameover'); return true; }

    if (S.talkCount >= 10) {
      // Sad trial if any companion died during the parley
      var talkDeaths = S.party.filter(function (c) {
        return c.id !== 'king' && c.hearts <= 0;
      }).length;
      endGame(talkDeaths > 0 ? 'sad_trial' : 'trial');
      return true;
    }

    if (S.boss.hp <= 0) {
      var maven = getChar('maven');
      // Traitor: Maven betrayed the party and is still alive
      if (S.mageBetrayed && maven && maven.hearts > 0) {
        endGame('traitor');
        return true;
      }
      // Iron Fist: King is the only survivor (solo run or last standing)
      var livingAllies = S.party.filter(function (c) {
        return c.id !== 'king' && c.hearts > 0;
      }).length;
      if (livingAllies === 0) {
        endGame('iron_fist');
        return true;
      }
      // Default combat victory
      endGame('vigilant');
      return true;
    }

    return false;
  }

  function endGame(result) {
    S.gameState = 'end';
    var msgs = {
      trial:     '\u2014 The Usurper lowers his sword. Words have won where steel could not. \u2014',
      vigilant:  '\u2014 The Usurper falls. The crown endures. Stay vigilant. \u2014',
      traitor:   '\u2014 The Usurper falls\u2026 but shadows still walk among you. \u2014',
      sad_trial: '\u2014 Peace is won. But not without cost. \u2014',
      iron_fist: '\u2014 You stand alone. The crown is yours by iron will alone. \u2014',
      gameover:  '\u2014 The King falls. The Crownless claim dies here. \u2014'
    };
    addLog(msgs[result] || '\u2014 The battle ends. \u2014');
    renderAll();

    var panel = document.getElementById('action-panel');
    if (panel) {
      panel.innerHTML = '<p class="duel-transition">Redirecting\u2026</p>';
    }
    setTimeout(function () {
      window.location.href = ENDINGS[result] || ENDINGS.gameover;
    }, 2800);
  }

  // ----------------------------------------------------------
  // RENDERING
  // ----------------------------------------------------------
  function renderAll() {
    renderBossBar();
    renderRouteBonus();
    renderPartyCards(null);
    renderLog();
  }

  function renderRouteBonus() {
    var armedEl = document.getElementById('duel-route-bonus');
    var bannersEl = document.getElementById('duel-banners-bonus');

    if (armedEl) {
      armedEl.hidden = !S.armedWell;
    }

    if (bannersEl) {
      bannersEl.hidden = !S.bannersRallied;
    }
  }

  function applyBannersPressure() {
    if (!S.bannersRallied) return;
    if (S.boss.hp <= (S.boss.maxHp / 2)) return;
    damageBoss(1, 'banners');
    addLog('\u2691 Banners Rallied \u2014 your forces strike from the flanks. Usurper \u22121 heart.');
  }

  function renderBossBar() {
    var boss = S.boss;
    var fill = document.getElementById('boss-hp-fill');
    var label = document.getElementById('boss-hp-label');
    var phaseEl = document.getElementById('boss-phase');
    var nameEl = document.getElementById('boss-name');

    if (fill) fill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + '%';
    if (label) label.textContent = boss.hp + ' / ' + boss.maxHp;
    if (nameEl) nameEl.textContent = bossDisplayName();
    if (phaseEl) {
      var p = bossPhase();
      var phases = ['', 'Phase I \u2014 Breach The Hold', 'Phase II \u2014 Duel Joined', 'Phase III \u2014 Final Exchange'];
      phaseEl.textContent = phases[p];
      phaseEl.className = 'boss-phase phase-' + p;
    }
  }

  function renderPartyCards(activeId) {
    var container = document.getElementById('party-cards');
    if (!container) return;
    container.innerHTML = '';

    S.party.forEach(function (c) {
      var status = statusOf(c);
      var betrayed = (c.id === 'maven' && S.mageBetrayed);
      var isActive = (c.id === activeId);
      var cls = ['party-card',
        'status-' + status.toLowerCase(),
        betrayed ? 'betrayer' : '',
        isActive ? 'active-char' : ''
      ].filter(Boolean).join(' ');

      var hearts = '';
      for (var i = 0; i < c.maxHearts; i++) {
        hearts += '<span class="heart ' + (i < c.hearts ? 'full' : 'empty') + '">\u2665</span>';
      }

      var extras = [];
      if (c.boosted)   extras.push('\u2728 Inspired');
      if (c.aimed)     extras.push('\uD83C\uDFF9 Aimed');
      if (c.protected) extras.push('\uD83D\uDD2E Protected');
      if (c.healing)   extras.push('\uD83C\uDF3F Healing (' + c.healing.turnsLeft + ')');
      if (c.escorted)  extras.push('\uD83E\uDD1D Escorted');
      var extraHtml = extras.length ? '<div class="card-extras">' + extras.join(' &bull; ') + '</div>' : '';

      var div = document.createElement('div');
      div.className = cls;
      div.innerHTML =
        '<div class="card-header">' +
          '<img class="card-avatar" src="' + iconPathFor(c, status) + '" alt="' + c.name + ' portrait" loading="lazy" decoding="async">' +
          '<div class="card-title">' +
            '<div class="card-name">' + c.name + '</div>' +
            '<div class="card-role">' + (betrayed ? '\u26A0 BETRAYER' : c.role) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-hearts">' + hearts + '</div>' +
        '<div class="card-status">' + (betrayed ? 'Hostile' : status) + '</div>' +
        extraHtml;
      container.appendChild(div);
    });
  }

  function renderLog() {
    var el = document.getElementById('combat-log');
    if (!el) return;
    el.innerHTML = S.log.map(function (l) { return '<p>' + l + '</p>'; }).join('');
  }

  function renderActionPanel(c) {
    var panel = document.getElementById('action-panel');
    var subtitle = document.getElementById('action-subtitle');
    if (!panel) return;

    if (S.gameState === 'end') {
      panel.innerHTML = '';
      return;
    }

    if (!c) { panel.innerHTML = ''; return; }
    if (subtitle) subtitle.textContent = c.name + '\u2019s turn \u2014 Round ' + S.round;

    var actions = buildActions(c);
    panel.innerHTML = actions.map(function (a) {
      var disabled = a.disabled ? ' disabled' : '';
      return '<button class="choice ' + (a.style || 'safe') + '"' + disabled +
             ' data-action="' + a.id + '">' + a.label + '</button>';
    }).join('');

    panel.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        onActionClick(btn.getAttribute('data-action'), c);
      });
    });
  }

  function renderSummaryPanel() {
    var panel = document.getElementById('action-panel');
    var subtitle = document.getElementById('action-subtitle');
    if (!panel) return;
    if (subtitle) subtitle.textContent = 'Round ' + (S.round - 1) + ' complete';

    var king = getChar('king');
    var kingOk = king && king.hearts > 0;
    panel.innerHTML =
      '<button class="choice safe" id="next-round-btn">' +
      (kingOk ? 'Begin Round ' + S.round : 'The battle is lost\u2026') +
      '</button>';

    var btn = document.getElementById('next-round-btn');
    if (btn && kingOk) {
      btn.addEventListener('click', function () { startRound(); });
    }
  }

  // ----------------------------------------------------------
  // ACTION BUILDER
  // ----------------------------------------------------------
  function buildActions(c) {
    var living = livingParty().filter(function (p) { return p.id !== c.id; });
    var dead = deadParty().filter(function (p) { return p.id !== 'maven' || !S.mageBetrayed; });
    var talkLabel = 'Talk to the Usurper (' + S.talkCount + '/10)';

    switch (c.id) {
      case 'king':
        return [
          { id: 'king_attack',  label: '\u2694 Sword \u2014 Strike (15% crit \u22122, else \u22121)',             style: 'risky' },
          { id: 'king_inspire', label: '\u2728 Inspire \u2014 Grant ally guaranteed crit next attack',           style: 'safe',     disabled: living.length === 0 },
          { id: 'king_rally',   label: '\uD83D\uDCE3 Rally \u2014 All party +5% crit chance (stacks)',           style: 'emotional' },
          { id: 'king_talk',    label: '\uD83D\uDCAC ' + talkLabel + ' (enrages Usurper toward King)',           style: 'emotional' }
        ];
      case 'harold':
        return [
          { id: 'harold_attack',  label: '\uD83D\uDD31 Flail \u2014 Strike (10% crit \u22122, 85% \u22121, 5% miss)',      style: 'risky' },
          { id: 'harold_defend',  label: '\uD83D\uDEE1 Defend \u2014 Absorb 1 damage for a chosen ally',                   style: 'safe',     disabled: living.length === 0 },
          { id: 'harold_escort',  label: '\uD83E\uDD1D Escort \u2014 Chosen ally acts twice next round',                   style: 'emotional', disabled: living.length === 0 },
          { id: 'harold_talk',    label: '\uD83D\uDCAC ' + talkLabel + ' (50% chance Usurper skips attack)',               style: 'emotional' }
        ];
      case 'brann':
        return [
          { id: 'brann_attack', label: '\uD83C\uDF3F Staff \u2014 Strike (5% crit \u22121, 70% \u22121, 25% miss)',        style: 'risky' },
          { id: 'brann_mend',   label: '\uD83C\uDF3F Mend \u2014 Heal ally +1 heart',                                      style: 'safe',     disabled: living.length === 0 },
          { id: 'brann_heal',   label: '\uD83C\uDF3F Heal \u2014 Skip next turn, ally +2 hearts',                          style: 'emotional', disabled: living.length === 0 },
          { id: 'brann_talk',   label: '\uD83D\uDCAC ' + talkLabel + ' (25% chance Usurper hesitates)',                    style: 'emotional' }
        ];
      case 'maven':
        return [
          { id: 'maven_attack',  label: '\uD83D\uDCD6 Tome \u2014 5% mega \u22123, 10% crit \u22122, 65% \u22121, 20% miss',  style: 'risky' },
          { id: 'maven_revive',  label: '\uD83D\uDCD6 Revival \u2014 Revive a fallen ally (1 heart)',                         style: 'safe',     disabled: dead.length === 0 },
          { id: 'maven_protect', label: '\uD83D\uDCD6 Ward \u2014 Skip next turn, ally 10% to negate damage',                 style: 'emotional', disabled: living.length === 0 },
          { id: 'maven_talk',    label: '\uD83D\uDCAC ' + talkLabel + ' \u26A0 Maven: ' + S.mageTalkCount + '/3 before betrayal', style: S.mageTalkCount >= 2 ? 'risky' : 'emotional' }
        ];
      case 'elya':
        return [
          { id: 'elya_attack',  label: '\uD83C\uDFF9 Bow \u2014 1% bullseye \u22123, 4% \u22122, 35% \u22121, 60% miss',  style: 'risky' },
          { id: 'elya_aim',     label: '\uD83C\uDFF9 Aim \u2014 Use action to guarantee max damage next shot',             style: 'safe' },
          { id: 'elya_lookout', label: '\uD83C\uDFF9 Lookout \u2014 Watch an ally; punish boss \u22121 if they\u2019re hit', style: 'emotional', disabled: living.length === 0 },
          { id: 'elya_talk',    label: '\uD83D\uDCAC ' + talkLabel + ' (enrages Usurper toward Elya)',                    style: 'emotional' }
        ];
    }
    return [];
  }

  // ----------------------------------------------------------
  // ACTION CLICK HANDLER
  // ----------------------------------------------------------
  var TARGET_PROMPTS = {
    king_inspire:  'Who does the King inspire?',
    harold_defend: 'Who does Harold defend?',
    harold_escort: 'Who does Harold escort?',
    brann_mend:    'Who does Brann mend?',
    brann_heal:    'Who does Brann pray for?',
    maven_revive:  'Who does Maven revive?',
    maven_protect: 'Who does Maven ward?',
    elya_lookout:  'Who does Elya watch over?'
  };

  function onActionClick(actionId, actingChar) {
    if (TARGET_PROMPTS[actionId]) {
      showTargetSelect(actionId, TARGET_PROMPTS[actionId], actingChar);
    } else {
      submitAction(actionId, null);
    }
  }

  function showTargetSelect(actionId, prompt, actingChar) {
    var panel = document.getElementById('action-panel');
    if (!panel) return;

    var targets;
    if (actionId === 'maven_revive') {
      targets = S.party.filter(function (c) { return c.hearts <= 0; });
    } else {
      targets = livingParty().filter(function (c) { return c.id !== actingChar.id; });
    }

    if (targets.length === 0) {
      addLog('No valid targets available.');
      submitAction(actingChar.id + '_attack', null);
      return;
    }

    panel.innerHTML = '<p class="action-subtitle">' + prompt + '</p>' +
      targets.map(function (t) {
        return '<button class="choice safe" data-target="' + t.id + '">' +
          t.name + ' \u2014 ' + statusOf(t) + ' (' + t.hearts + '/' + t.maxHearts + '\u2665)' +
          '</button>';
      }).join('');

    panel.querySelectorAll('button[data-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        submitAction(actionId, btn.getAttribute('data-target'));
      });
    });
  }

  // ----------------------------------------------------------
  // BOOT
  // ----------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);

})();
