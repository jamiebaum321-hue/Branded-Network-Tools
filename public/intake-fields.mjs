import { departments } from './solution-model.mjs';
export const sections = [
  { title: '1. Ideal Customer Profile (ICP)', description:'Describe your ideal buyer, segment, geography and footprint.', fields: [
    { key: 'company', label: 'Company name', required: true, max: 180 },
    { key: 'contact_name', label: 'Primary contact name', required: true, max: 150 },
    { key: 'contact_email', label: 'Primary contact email', type: 'email', required: true, max: 254 },
    { key: 'phone', label: 'Phone', type: 'tel', max: 70 },
    { key: 'icp', label: 'Who is your ideal customer?', type: 'textarea', hint:'You can also share an existing ICP document or link.', required: false, max: 5000 },
    { key: 'segment', label: 'Restaurant segment', max: 200 },
    { key: 'geography', label: 'Geography', max: 200 },
    { key: 'minimum_locations', label: 'Minimum locations', type: 'number' },
    { key: 'ideal_locations', label: 'Ideal locations', type: 'number' },
    { key: 'footprint', label: 'Footprint or other criteria', max: 400 },
  ] },
  { title: '2. Current Customers', description:'Customer list, including key accounts, enterprise relationships and notable success stories.', fields: [
    { key: 'current_customers', label: 'Current customers', add: 'Add customer', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'link', label: 'List link', type: 'url', max: 600 },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
  ] },
  { title: '3. Priority Targets', description:'Top 10 to 20 companies you’d most like to engage, including existing relationships or contacts.', fields: [
    { key: 'priority_targets', label: 'Priority targets', add: 'Add target', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'contact', label: 'Person', max: 150 },
      { key: 'link', label: 'List link', type: 'url', max: 600 }, { key: 'notes', label: 'Reason or priority', max: 600 },
    ] },
  ] },
  { title: '4. Current Sales Pipeline', description:'Share active opportunities, target accounts and their stage of engagement so we can avoid overlap and accelerate conversations.', fields: [
    { key: 'sales_pipeline', label: 'Current sales pipeline', add: 'Add opportunity', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'contact', label: 'Person', max: 150 },
      { key: 'status', label: 'Status', max: 120 }, { key: 'link', label: 'Pipeline link', type: 'url', max: 600 },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
  ] },
  { title: '5. Strategic & Channel Partnerships', description:'Existing relationships, referral partners, distribution channels and priority partnership opportunities, if applicable.', fields: [
    { key: 'partnerships', label: 'Strategic and channel partnerships', add: 'Add partner', rows: [
      { key: 'company', label: 'Partner', max: 180 }, { key: 'contact', label: 'Partner contact', max: 150 }, { key: 'relationship', label: 'Relationship', max: 200 },
      { key: 'link', label: 'Link', type: 'url', max: 600 }, { key: 'notes', label: 'Notes', max: 600 },
    ] },
  ] },
  { title: '6. Technology & Integrations', description:'Existing technology integrations, platform partners and desired integrations, if applicable.', fields: [
    { key: 'current_integrations', label: 'Current integrations', type: 'textarea', max: 2500 },
    { key: 'desired_integrations', label: 'Desired integrations', type: 'textarea', max: 2500 },
  ] },
  { title: '7. Sales, Marketing & Media Assets', description:'Share company logos and brand guidelines, product or service one-pagers, customer case studies and testimonials, product demos and videos, press coverage and marketing collateral.', fields: [
    { key: 'assets', label: 'Sales, marketing and media assets', add: 'Add link', rows: [
      { key: 'label', label: 'Asset name', max: 150 }, { key: 'link', label: 'Asset link', type: 'url', max: 600 },
    ] },
    { key: 'linkedin', label: 'LinkedIn', type: 'url', max: 600 }, { key: 'x', label: 'X', type: 'url', max: 600 },
  ] },
  { title: '8. Strategic Growth Priorities', description:'Your top three priorities for the next six months, including target accounts, strategic partnerships, market expansion or other growth opportunities.', fields: [
    { key: 'priorities', label: 'Engagement priorities', type: 'textarea', max: 4000 },
    { key: 'kpis', label: 'How will you measure success?', type: 'textarea', max: 2500 },
    { key: 'exclusions', label: 'Other targets to exclude', type: 'textarea', max: 2500 },
  ] },
  { title: '9. Key Team Members', description:'Primary contacts across leadership, sales, business development, marketing and partnerships.', fields: [
    { key: 'billing_name', label: 'Accounts payable contact', max: 150 },
    { key: 'billing_email', label: 'Invoice recipient email', type: 'email', max: 254 },
    { key: 'billing_instructions', label: 'Invoice instructions or purchase order requirements', type: 'textarea', max: 1500 },
    { key: 'team', label: 'Key team members', add: 'Add team member', rows: [
      { key: 'first_name', label: 'First name', max: 100 }, { key: 'last_name', label: 'Last name', max: 100 },
      { key: 'email', label: 'Email', type: 'email', max: 254 }, { key: 'title', label: 'Job title', max: 150 },
      { key: 'phone', label: 'Phone number', type: 'tel', max: 70 }, { key: 'department', label: 'Function', options: departments, max: 100 },
      { key: 'notes', label: 'Contact notes', type: 'textarea', max: 2500 },
    ] },
  ] },
];
