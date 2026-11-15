(function(root){
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=mode=>mode==='north'||mode==='yonma'?4:3;
  const label=mode=>({north:'四人三麻',yonma:'四人麻雀'}[mode]||'三麻');
  const format=n=>(n>0?'+':'')+n.toLocaleString('ja-JP');
  function rankRows(set){
    const rows=set.players.map(player=>({player,rounds:0,ranks:[0,0,0,0],fourPlayerRounds:0}));
    for(const round of set.rounds){
      const played=rows.filter(({player})=>{
        const score=round.scores?.[player.id];
        return score!=null&&score!==''&&score!=='skip'&&Number.isInteger(Number(score));
      });
      if(played.length!==size(round.mode))continue;
      for(const row of played){
        const score=Number(round.scores[row.player.id]);
        const rank=played.filter(other=>Number(round.scores[other.player.id])>score).length;
        row.ranks[rank]++;row.rounds++;
        if(size(round.mode)===4)row.fourPlayerRounds++;
      }
    }
    return rows;
  }
  function scoreTable(set,{nameOf=p=>p.name}={}){
    const names=set.players.map(p=>escape(nameOf(p)));
    return '<div class="score-scroll" role="region" aria-label="半荘別スコア（対局者名を固定）" tabindex="0"><table class="history-table set-score-table" style="min-width:'+Math.max(340,90+set.players.length*82)+'px"><thead><tr><th scope="col">半荘</th>'+names.map(name=>'<th scope="col">'+name+'</th>').join('')+'</tr></thead><tbody>'+set.rounds.map((round,index)=>'<tr><th scope="row">'+(index+1)+'<small>'+label(round.mode)+'</small></th>'+set.players.map(p=>{
      const score=round.scores?.[p.id];
      const text=score==='skip'?'抜け':score==null||score===''?'—':Number.isFinite(Number(score))?format(Number(score)):escape(score);
      return '<td'+(Number(score)<0?' class="negative"':'')+'>'+text+'</td>';
    }).join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function analysis(set,{nameOf=p=>p.name}={}){
    const rows=rankRows(set);
    return '<section class="set-rank-analysis"><h4>このセットの着順回数・割合</h4><div class="rank-summary-scroll" role="region" aria-label="着順回数・割合" tabindex="0"><table class="history-table rank-summary"><thead><tr><th scope="col">プレイヤー</th><th scope="col">有効半荘</th><th scope="col">1着</th><th scope="col">2着</th><th scope="col">3着</th><th scope="col">4着</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+escape(nameOf(row.player))+'</th><td>'+row.rounds+'回</td>'+row.ranks.map((count,index)=>'<td>'+(index===3&&!row.fourPlayerRounds?'—':count+'回 <small>（'+(row.rounds?(count*100/row.rounds).toFixed(1)+'%':'—')+'）</small>')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p class="hint">各人が参加し、必要人数の点数がそろった半荘を集計。抜け・未入力は除外し、同点は同順位です。三麻だけの参加者の4着は「—」。種目が混在するセットは合算します。</p></section>';
  }
  function render(set,options){
    return analysis(set,options)+'<details class="set-round-details"><summary>半荘別スコア</summary><p class="hint">表の中をスクロールしても、上の対局者名と左の半荘番号は固定されます。</p>'+scoreTable(set,options)+'</details>';
  }
  const api={rankRows,scoreTable,analysis,render};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.TakechartSetView=api;
})(typeof window==='undefined'?{}:window);
