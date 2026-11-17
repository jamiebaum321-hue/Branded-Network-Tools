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
};

export const statusTone = {
  High: 'red', Medium: 'amber', Low: 'neutral', Open: 'amber', 'In Progress': 'blue', Resolved: 'green',
  'Not Started': 'neutral', 'Needs Confirmation': 'amber', Complete: 'green', 'N/A': 'neutral',
  'Not invoiced': 'neutral', 'Handoff sent': 'blue', Invoiced: 'blue', 'Partially paid': 'amber', Paid: 'green', Overdue: 'red', Yes: 'green', No: 'neutral',
};
