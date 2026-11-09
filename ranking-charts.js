const rankingCharts = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt = value => (value > 0 ? '+' : '') + value.toLocaleString('ja-JP');
  function rating(name, points) {
  const values=[points[0].before,...points.map(p=>p.rating)];
  const min=values.reduce((a,b)=>Math.min(a,b));
  const max=values.reduce((a,b)=>Math.max(a,b));
  const path=values.map((v,i)=>`${38+i*274/(values.length-1)},${max===min?56:100-(v-min)*88/(max-min)}`).join(' ');
  return `<figure class="player-trend"><figcaption>${esc(name)}のR推移　${Math.round(values[0])} → ${Math.round(values.at(-1))}</figcaption><svg viewBox="0 0 324 124" role="img" aria-label="選択期間のレーティング推移"><text x="2" y="${max===min?60:15}" font-size="10">${Math.round(max)}</text>${max!==min?`<text x="2" y="104" font-size="10">${Math.round(min)}</text>`:''}<polyline points="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5"/><text x="38" y="118" font-size="9">${esc(points[0].date)}</text>${points.length>1?`<text x="312" y="118" text-anchor="end" font-size="9">${esc(points.at(-1).date)}</text>`:''}</svg></figure>`;
  }
  function personal(label, unit, points) {
    const values=[0,...points.map(point=>point.value)];
    const min=values.reduce((a,b)=>Math.min(a,b),0);
    const max=values.reduce((a,b)=>Math.max(a,b),0);
    const x=index=>54+index*254/(values.length-1);
    const y=value=>max===min?51:92-(value-min)*80/(max-min);
    const path=values.map((value,index)=>`${x(index)},${y(value)}`).join(' ');
    const last=values.at(-1);
    const ticks=max===min?[0]:[max,min];
    return `<figure class="player-trend"><figcaption>${label}　${fmt(last)} ${unit}</figcaption>
      <svg viewBox="0 0 324 116" role="img" aria-label="${label}の累計推移">
      <line x1="54" x2="308" y1="${y(0)}" y2="${y(0)}" stroke="#b4b4ba" stroke-dasharray="3 3"/>
      ${ticks.map(value=>`<text x="49" y="${y(value)+3}" text-anchor="end" font-size="9" fill="#555861">${fmt(value)}</text>`).join('')}
      <polyline points="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="${x(values.length-1)}" cy="${y(last)}" r="3" fill="var(--accent)"/>
      <text x="54" y="110" font-size="9" fill="#555861">${esc(points[0].date)}</text>
      ${points.length>1?`<text x="308" y="110" text-anchor="end" font-size="9" fill="#555861">${esc(points.at(-1).date)}</text>`:''}
      </svg></figure>`;
  }
  return {rating, personal};
})();
