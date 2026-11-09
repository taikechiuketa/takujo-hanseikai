(() => {
  const tags = { b:'strong', i:'em', u:'u', red:'span' };
  function inline(node, text) {
    const stack = [node];
    const open = [];
    for (const token of text.split(/(\[\/?(?:b|i|u|red)\])/g)) {
      const match = /^\[(\/?)(b|i|u|red)\]$/.exec(token);
      if (match && !match[1]) {
        const child = document.createElement(tags[match[2]]);
        if (match[2] === 'red') child.style.color = '#b42318';
        stack.at(-1).append(child);
        stack.push(child);
        open.push(match[2]);
      } else if (match && open.at(-1) === match[2]) {
        stack.pop();
        open.pop();
      } else stack.at(-1).append(token);
    }
  }
  function render(target, text) {
    const fragment = document.createDocumentFragment();
    let list;
    for (const line of (text || 'ルールは未設定です。').split(/\r?\n/)) {
      const prefix = /^(- |・|\d+\. )/.exec(line);
      const heading = line.startsWith('### ');
      const node = document.createElement(prefix ? 'li' : heading ? 'h3' : 'div');
      inline(node, prefix ? line.slice(prefix[0].length) : heading ? line.slice(4) : line || '\u00a0');
      if (prefix) {
        const name = /^\d/.test(prefix[0]) ? 'ol' : 'ul';
        if (list?.localName !== name) {
          list = document.createElement(name);
          fragment.append(list);
        }
        list.append(node);
      } else {
        list = null;
        fragment.append(node);
      }
    }
    target.replaceChildren(fragment);
  }
  function attach(field, toolbar, preview) {
    const controls = [['太字','b'],['赤字','red'],['斜体','i'],['下線','u'],
      ['見出し','### '],['箇条書き','- '],['番号付き','1. '],['書式解除','']];
    const update = () => render(preview, field.value);
    field.addEventListener('input', update);
    for (const [label, format] of controls) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = label;
      button.onclick = () => {
        let {selectionStart:start, selectionEnd:end} = field;
        const lineFormat = !format || format.endsWith(' ');
        if (lineFormat) {
          start = field.value.lastIndexOf('\n', start - 1) + 1;
          const boundary = field.value.indexOf('\n', end);
          end = boundary < 0 ? field.value.length : boundary;
        }
        const selected = field.value.slice(start, end);
        const plain = selected.replace(/^(?:### |- |・|\d+\. )/gm, '');
        const replacement = !format ? plain.replace(/\[\/?(?:b|i|u|red)\]/g, '')
          : lineFormat ? plain.split('\n').map(line => format + line).join('\n')
          : selected.split('\n').map(line => '['+format+']'+line+'[/'+format+']').join('\n');
        if (field.value.length - (end - start) + replacement.length > field.maxLength) return;
        field.setRangeText(replacement, start, end, 'select');
        if (!lineFormat && !selected.includes('\n')) {
          const offset = start + format.length + 2;
          field.setSelectionRange(offset, offset + selected.length);
        }
        field.focus();
        update();
      };
      toolbar.append(button);
    }
    update();
  }
  window.TakujoRuleText = { render, attach };
})();
