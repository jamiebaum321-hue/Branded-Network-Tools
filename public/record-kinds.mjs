// Shared by the server and the browser: the working records each client page keeps.
// Field types: text, textarea, int, number, date (YYYY-MM-DD), month (YYYY-MM), url, choice.
const priority = ['High', 'Medium', 'Low'];

export const recordKinds = {
  issues: {
    label: 'Issues', singular: 'issue', glyph: 'flag', title: 'issue', meta: ['area', 'owner', 'raised'], badges: ['priority', 'status'],
    fields: [
      { key: 'issue', label: 'Issue', type: 'textarea', required: true },
      { key: 'priority', label: 'Priority', type: 'choice', options: priority },
      { key: 'status', label: 'Status', type: 'choice', options: ['Open', 'In Progress', 'Resolved'] },
      { key: 'area', label: 'Area', type: 'text' },
      { key: 'owner', label: 'Owner', type: 'text' },
      { key: 'raised', label: 'Raised', type: 'date' },
      { key: 'evidence', label: 'Evidence', type: 'textarea' },
      { key: 'resolution', label: 'Resolution / next action', type: 'textarea' },
    ],
  },
  onboarding: {
    label: 'Onboarding checklist', singular: 'checklist item', glyph: 'check', title: 'item', meta: ['category', 'owner', 'due'], badges: ['status'],
    fields: [
      { key: 'no', label: 'Order', type: 'int' },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'owner', label: 'Owner', type: 'text' },
      { key: 'status', label: 'Status', type: 'choice', options: ['Not Started', 'In Progress', 'Needs Confirmation', 'Complete', 'N/A'] },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  kpis: {
    label: 'Monthly KPIs', singular: 'month of KPIs', glyph: 'metrics', key: 'month', title: 'month',
    meta: ['posts', 'impressions', 'engagements', 'newsletter', 'podcast', 'events', 'meetings'],
    fields: [
      { key: 'month', label: 'Month', type: 'month', required: true },
      { key: 'posts', label: 'Social posts', type: 'int' },
      { key: 'impressions', label: 'Impressions', type: 'int' },
      { key: 'engagements', label: 'Engagements', type: 'int' },
      { key: 'newsletter', label: 'Newsletter mentions', type: 'int' },
      { key: 'podcast', label: 'Podcast features', type: 'int' },
      { key: 'events', label: 'Events', type: 'int' },
      { key: 'meetings', label: 'Meetings', type: 'int' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  reports: {
    label: 'Monthly reports', singular: 'monthly report', glyph: 'draft', key: 'month', title: 'month', meta: [],
    fields: [
      { key: 'month', label: 'Month', type: 'month', required: true },
      { key: 'highlights', label: 'Highlights', type: 'textarea' },
      { key: 'help', label: 'Where we need their help', type: 'textarea' },
    ],
  },
  billing: {
    label: 'Billing', singular: 'billing record', glyph: 'stack', title: 'invoice_no', meta: ['invoice_date', 'amount', 'bill_to', 'terms'], badges: ['status'],
    fields: [
      { key: 'invoice_no', label: 'Invoice number', type: 'text' },
      { key: 'status', label: 'Status', type: 'choice', options: ['Not invoiced', 'Handoff sent', 'Invoiced', 'Partially paid', 'Paid', 'Overdue'] },
      { key: 'invoice_date', label: 'Invoice date', type: 'date' },
      { key: 'amount', label: 'Amount (USD)', type: 'number' },
      { key: 'bill_to', label: 'Bill to', type: 'text' },
      { key: 'terms', label: 'Terms', type: 'text' },
      { key: 'handoff_sent', label: 'Handoff to Accounting', type: 'date' },
      { key: 'handoff_by', label: 'Handoff sent by', type: 'text' },
      { key: 'paid_on', label: 'Paid on', type: 'date' },
      { key: 'line', label: 'Invoice line', type: 'textarea' },
      { key: 'notes', label: 'Notes and flags', type: 'textarea' },
    ],
  },
  intel: {
    label: 'Market intel', singular: 'intel item', glyph: 'target', title: 'headline', meta: ['date', 'competitor', 'type', 'source'],
    fields: [
      { key: 'headline', label: 'Headline', type: 'text', required: true },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'competitor', label: 'Competitor', type: 'text' },
      { key: 'type', label: 'Type', type: 'choice', options: ['Customer win', 'Funding', 'Launch', 'Partnership', 'Hire', 'Pricing', 'Setback', 'Other'] },
      { key: 'summary', label: 'Summary', type: 'textarea' },
      { key: 'opportunity', label: 'Opportunity for the client', type: 'textarea' },
      { key: 'target', label: 'Suggested target', type: 'text' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'url', label: 'Link', type: 'url' },
    ],
  },
  briefs: {
    label: 'Weekly intel briefs', singular: 'weekly brief', glyph: 'today', key: 'week', title: 'week', meta: [],
    fields: [
      { key: 'week', label: 'Week of', type: 'date', required: true },
      { key: 'summary', label: 'Summary', type: 'textarea' },
      { key: 'opportunities', label: 'Opportunities (one per line)', type: 'textarea' },
    ],
  },
  wins: {
    label: 'Weekly wins', singular: 'weekly win', glyph: 'shortlist', key: 'week', title: 'win', meta: ['week', 'asked_by', 'source'], badges: ['used'],
    fields: [
      { key: 'week', label: 'Week of', type: 'date', required: true },
      { key: 'win', label: 'Win', type: 'textarea', required: true },
      { key: 'asked_by', label: 'Asked by', type: 'text' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'used', label: 'Used in content', type: 'choice', options: ['No', 'Yes'] },
    ],
  },
};

export const statusTone = {
  High: 'red', Medium: 'amber', Low: 'neutral', Open: 'amber', 'In Progress': 'blue', Resolved: 'green',
  'Not Started': 'neutral', 'Needs Confirmation': 'amber', Complete: 'green', 'N/A': 'neutral',
  'Not invoiced': 'neutral', 'Handoff sent': 'blue', Invoiced: 'blue', 'Partially paid': 'amber', Paid: 'green', Overdue: 'red', Yes: 'green', No: 'neutral',
};
