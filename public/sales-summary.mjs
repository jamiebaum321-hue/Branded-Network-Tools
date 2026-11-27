const numbers = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];

function contractValue(details) {
  if (details.deal_value != null) return details.deal_value;
  const term = (details.term || '').toLowerCase().trim();
  const match = /^(\d+(?:\.\d+)?|[a-z]+)[\s-]*(months?|mos?|years?|yrs?)\b/.exec(term);
  const quantity = match && (/^\d/.test(match[1]) ? Number(match[1]) : numbers.indexOf(match[1]));
  const months = quantity > 0 ? quantity * (/^y/.test(match[2]) ? 12 : 1) : /^(annual|yearly|one-year)\b/.test(term) ? 12 : 1;
  return (details.project_fee || 0) + Math.round((details.monthly || 0) * months);
}

export function salesSummary(deals) {
  let won=0, lost=0, mrr=0;
  for (const deal of deals) {
    if (deal.signed_at || deal.stage==='signed') {
      won += contractValue(deal.details);
      if (deal.stage!=='complete') mrr += deal.details.monthly || 0;
    } else if (deal.stage==='dead') lost += contractValue(deal.details);
  }
  return {won,lost,mrr,arr:mrr*12};
}
