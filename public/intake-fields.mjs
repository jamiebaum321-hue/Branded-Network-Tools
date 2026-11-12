export const sections = [
  { title: 'Company & contact', fields: [
    { key: 'company', label: 'Company name', required: true, max: 180 },
    { key: 'contact_name', label: 'Primary contact name', required: true, max: 150 },
    { key: 'contact_email', label: 'Primary contact email', type: 'email', required: true, max: 254 },
    { key: 'phone', label: 'Phone', type: 'tel', max: 70 },
  ] },
  { title: 'Ideal customer', fields: [
    { key: 'icp', label: 'Who is your ideal customer?', type: 'textarea', required: true, max: 5000 },
    { key: 'segment', label: 'Restaurant segment', max: 200 },
    { key: 'geography', label: 'Geography', max: 200 },
    { key: 'minimum_locations', label: 'Minimum locations', type: 'number' },
    { key: 'ideal_locations', label: 'Ideal locations', type: 'number' },
    { key: 'footprint', label: 'Footprint or other criteria', max: 400 },
  ] },
  { title: 'Customers & targets', fields: [
    { key: 'current_customers', label: 'Current customers', add: 'Add customer', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'link', label: 'List link', type: 'url', max: 600 },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
    { key: 'priority_targets', label: 'Priority targets', add: 'Add target', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'contact', label: 'Person', max: 150 },
      { key: 'link', label: 'List link', type: 'url', max: 600 }, { key: 'notes', label: 'Reason or priority', max: 600 },
    ] },
  ] },
  { title: 'Sales & partnerships', fields: [
    { key: 'sales_pipeline', label: 'Current sales pipeline', add: 'Add opportunity', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'contact', label: 'Person', max: 150 },
      { key: 'status', label: 'Status', max: 120 }, { key: 'link', label: 'Pipeline link', type: 'url', max: 600 },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
    { key: 'partnerships', label: 'Strategic and channel partnerships', add: 'Add partner', rows: [
      { key: 'company', label: 'Partner', max: 180 }, { key: 'relationship', label: 'Relationship', max: 200 },
      { key: 'link', label: 'Link', type: 'url', max: 600 }, { key: 'notes', label: 'Notes', max: 600 },
    ] },
  ] },
  { title: 'Technology & assets', fields: [
    { key: 'current_integrations', label: 'Current integrations', type: 'textarea', max: 2500 },
    { key: 'desired_integrations', label: 'Desired integrations', type: 'textarea', max: 2500 },
    { key: 'assets', label: 'Sales, marketing and media assets', add: 'Add link', rows: [
      { key: 'label', label: 'Asset name', max: 150 }, { key: 'link', label: 'Asset link', type: 'url', max: 600 },
    ] },
    { key: 'linkedin', label: 'LinkedIn', type: 'url', max: 600 }, { key: 'x', label: 'X', type: 'url', max: 600 },
  ] },
  { title: 'Team & review', fields: [
    { key: 'team', label: 'Key team members', add: 'Add team member', rows: [
      { key: 'first_name', label: 'First name', max: 100 }, { key: 'last_name', label: 'Last name', max: 100 },
      { key: 'email', label: 'Email', type: 'email', max: 254 }, { key: 'title', label: 'Job title', max: 150 },
    ] },
    { key: 'exclusions', label: 'Other targets to exclude', type: 'textarea', max: 2500 },
  ] },
];
