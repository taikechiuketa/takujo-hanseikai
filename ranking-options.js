const rankingFields = {
  totals: {points:'ポイント',balance:'収支',chips:'チップ',sets:'セット数',rounds:'半荘数',top:'トップ率',last:'ラス率',placements:'着順別回数'},
  rating: {rating:'現在のレート',ratingRounds:'対象半荘数',change:'直近の増減',trend:'レート推移'},
  personal: {points:'累計ポイント',balance:'累計収支',chips:'累計チップ',rounds:'半荘数',averagePoints:'平均ポイント',averagePlace:'平均順位',top:'トップ率',topTwo:'連対率',last:'ラス率',placements:'着順内訳',opponents:'対戦相手別成績'},
};
const rankingSections = {totals:'通算成績',rating:'レーティング',personal:'個人成績'};
const defaultRankingOptions = {totals:['points','rounds'],rating:[],personal:[]};
