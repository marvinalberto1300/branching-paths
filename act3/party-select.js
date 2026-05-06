(function () {
  var PARTY_META = {
    brann: { name: 'Brann', role: 'Cleric', icon: '../final-battle-icons/bran-healthy.png' },
    elya: { name: 'Elya', role: 'Archer', icon: '../final-battle-icons/elya-healthy.png' },
    harold: { name: 'Harold', role: 'Knight', icon: '../final-battle-icons/harold-healthy.png' },
    maven: { name: 'Maven', role: 'Mage', icon: '../final-battle-icons/maven-healthy.png' }
  };

  function parseCsv(raw) {
    if (!raw) return [];
    return raw.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  }

  function titleCaseIds(ids) {
    return ids.map(function (id) {
      var m = PARTY_META[id];
      return m ? m.name : id;
    });
  }

  function createChoice(id, selectedSet) {
    var meta = PARTY_META[id];
    if (!meta) return null;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'party-choice';
    button.setAttribute('data-char-id', id);
    button.setAttribute('aria-pressed', selectedSet.has(id) ? 'true' : 'false');

    var img = document.createElement('img');
    img.src = meta.icon;
    img.alt = meta.name + ' portrait';

    var textWrap = document.createElement('span');

    var name = document.createElement('span');
    name.className = 'party-choice-name';
    name.textContent = meta.name;

    var role = document.createElement('span');
    role.className = 'party-choice-role';
    role.textContent = meta.role;

    textWrap.appendChild(name);
    textWrap.appendChild(document.createElement('br'));
    textWrap.appendChild(role);

    button.appendChild(img);
    button.appendChild(textWrap);

    return button;
  }

  function buildHref(baseHref, selected, config) {
    var params = new URLSearchParams();

    params.set('party', selected.join(','));
    params.set('difficulty', config.difficulty || 'hard');

    if (config.armedWell === '1') {
      params.set('armedWell', '1');
    } else {
      params.delete('armedWell');
    }

    if (config.bannersRallied === '1') {
      params.set('bannersRallied', '1');
    } else {
      params.delete('bannersRallied');
    }

    return 'act3_party_confirm.html?' + params.toString();
  }

  function initPartySelector(section) {
    var grid = section.querySelector('[data-party-grid]');
    var summary = section.querySelector('[data-party-summary]');
    var continueLink = section.querySelector('[data-party-continue]');
    var linkUrl;
    var available;
    var selectedSet;
    var config;

    if (!grid || !summary || !continueLink) return;

    linkUrl = new URL(continueLink.getAttribute('href'), window.location.href);

    available = parseCsv(section.dataset.available || linkUrl.searchParams.get('party') || '');
    selectedSet = new Set(parseCsv(section.dataset.default || ''));
    config = {
      difficulty: section.dataset.difficulty || linkUrl.searchParams.get('difficulty') || 'hard',
      armedWell: section.dataset.armedWell || (linkUrl.searchParams.get('armedWell') === '1' ? '1' : '0'),
      bannersRallied: section.dataset.bannersRallied || (linkUrl.searchParams.get('bannersRallied') === '1' ? '1' : '0')
    };

    if (available.length === 0) {
      summary.textContent = 'No companions are available on this path. You will face the throne room alone.';
      continueLink.href = buildHref(continueLink.href, [], config);
      return;
    }

    available.forEach(function (id) {
      var choice = createChoice(id, selectedSet);
      if (!choice) return;
      if (selectedSet.has(id)) choice.classList.add('is-selected');

      choice.addEventListener('click', function () {
        if (selectedSet.has(id)) {
          selectedSet.delete(id);
        } else {
          selectedSet.add(id);
        }
        updateUi();
      });

      grid.appendChild(choice);
    });

    function orderedSelected() {
      return available.filter(function (id) { return selectedSet.has(id); });
    }

    function updateUi() {
      var selected = orderedSelected();

      grid.querySelectorAll('.party-choice').forEach(function (btn) {
        var id = btn.getAttribute('data-char-id');
        var isSelected = selectedSet.has(id);
        btn.classList.toggle('is-selected', isSelected);
        btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      });

      if (selected.length === 0) {
        summary.textContent = 'Selected: none (you will march alone).';
      } else {
        summary.textContent = 'Selected: ' + titleCaseIds(selected).join(', ') + '.';
      }

      continueLink.href = buildHref(continueLink.href, selected, config);
    }

    updateUi();
  }

  document.querySelectorAll('.party-select[data-available]').forEach(initPartySelector);
})();
