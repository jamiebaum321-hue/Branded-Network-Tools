// Onboarding form definition, shared by the browser, the server validator and the PDF export.
// Keys are stable: saved answers and imports refer to them. Add fields; do not rename keys.
export const formVersion = 2;

const segments = ['Quick service (QSR)', 'Fast casual', 'Casual dining', 'Fine dining', 'Coffee & bakery', 'Pizza',
  'Bars & nightlife', 'Hotels & resorts', 'Convenience & grocery', 'Ghost & virtual kitchens', 'Catering & events',
  'Non-commercial (campus, healthcare, corporate)', 'Entertainment & venues'];
const categories = ['POS & payments', 'Online ordering & delivery', 'Loyalty & marketing', 'Labor & scheduling',
  'Back-of-house & inventory', 'Kitchen equipment & automation', 'Data & analytics', 'Food & beverage supplier',
  'Staffing & training', 'Finance & accounting', 'Other'];

export const sections = [
  { title: 'Company & contacts', intro: 'The basics, and who we work with day to day.', fields: [
    { key: 'company', label: 'Company name', required: true, max: 180 },
    { key: 'website', label: 'Website', type: 'url', max: 600, placeholder: 'https://' },
    { key: 'headquarters', label: 'Headquarters', max: 200, placeholder: 'City, state or country' },
    { key: 'company_size', label: 'Company size', type: 'select', options: ['1–10', '11–50', '51–200', '201–500', '501–1,000', 'More than 1,000'] },
    { key: 'contact_name', label: 'Primary contact name', required: true, max: 150 },
    { key: 'contact_title', label: 'Primary contact title', max: 160 },
    { key: 'contact_email', label: 'Primary contact email', type: 'email', required: true, max: 254 },
    { key: 'phone', label: 'Phone', type: 'tel', max: 70 },
    { key: 'executive_sponsor', label: 'Executive sponsor', max: 200, hint: 'Name and title of the leader backing this partnership.' },
  ] },
  { title: 'Product & positioning', intro: 'How we should describe you when we make an introduction.', fields: [
    { key: 'pitch', label: 'What you do, in one or two sentences', type: 'textarea', required: true, max: 600,
      hint: 'We use this as the opening line of an introduction.' },
    { key: 'category', label: 'Solution category', type: 'multi', options: categories },
    { key: 'product', label: 'Products or services to introduce', type: 'textarea', max: 2500 },
    { key: 'differentiators', label: 'Why customers choose you over alternatives', type: 'textarea', max: 2500 },
    { key: 'proof_points', label: 'Results and proof points', type: 'textarea', max: 2500,
      hint: 'Numbers, case studies and customer quotes we are allowed to share.' },
    { key: 'pricing', label: 'Pricing model and typical deal size', max: 400 },
    { key: 'sales_cycle', label: 'Typical sales cycle', max: 200, placeholder: 'For example, 60–90 days' },
    { key: 'competitors', label: 'Competitors', add: 'Add competitor', hint: 'We keep competitors out of your introductions.', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'notes', label: 'How you differ', max: 600 },
    ] },
  ] },
  { title: 'Ideal customer', intro: 'The more specific this is, the better the matches we find.', fields: [
    { key: 'icp', label: 'Who is your ideal customer?', type: 'textarea', required: true, max: 5000,
      hint: 'Describe the companies you most want to meet, in your own words.' },
    { key: 'segments', label: 'Restaurant and hospitality segments', type: 'multi', options: segments },
    { key: 'segment', label: 'Other segment details', max: 200 },
    { key: 'ownership', label: 'Ownership model', type: 'multi',
      options: ['Corporate-owned', 'Franchisor (brand)', 'Franchisee groups', 'Independent operators', 'Management companies'] },
    { key: 'geography', label: 'Geography', max: 200, placeholder: 'For example, US and Canada' },
    { key: 'minimum_locations', label: 'Minimum locations', type: 'number' },
    { key: 'ideal_locations', label: 'Ideal locations', type: 'number' },
    { key: 'maximum_locations', label: 'Maximum locations', type: 'number' },
    { key: 'footprint', label: 'Footprint or other criteria', max: 400, placeholder: 'For example, drive-thru, revenue, growth rate' },
    { key: 'tech_requirements', label: 'Technology they must use or be open to', type: 'textarea', max: 2500 },
    { key: 'buying_triggers', label: 'Signals that a company is a good fit right now', type: 'textarea', max: 2500,
      hint: 'For example, expansion, new leadership, a POS change or new funding.' },
    { key: 'disqualifiers', label: 'Who is not a fit', type: 'textarea', max: 2500 },
  ] },
  { title: 'Buyers', intro: 'The people inside those companies you want to reach.', fields: [
    { key: 'personas', label: 'Who should we introduce you to?', add: 'Add buyer', rows: [
      { key: 'title', label: 'Job title', max: 160 }, { key: 'department', label: 'Department', max: 160 },
      { key: 'role', label: 'Role in the decision', max: 160, placeholder: 'Decision maker, influencer, champion' },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
    { key: 'buyer_notes', label: 'What these buyers care about', type: 'textarea', max: 2500 },
    { key: 'qualified_intro', label: 'What makes an introduction qualified for you?', type: 'textarea', max: 2500 },
  ] },
  { title: 'Customers & targets', intro: 'So we build on what you have and never cross wires.', fields: [
    { key: 'current_customers', label: 'Current customers', add: 'Add customer', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'link', label: 'List link', type: 'url', max: 600 },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
    { key: 'priority_targets', label: 'Priority targets', add: 'Add target', hint: 'Companies or people you most want to meet.', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'contact', label: 'Person', max: 150 },
      { key: 'link', label: 'List link', type: 'url', max: 600 }, { key: 'notes', label: 'Reason or priority', max: 600 },
    ] },
    { key: 'sales_pipeline', label: 'Deals already in progress', add: 'Add opportunity', hint: 'We check with you before contacting these.', rows: [
      { key: 'company', label: 'Company', max: 180 }, { key: 'contact', label: 'Person', max: 150 },
      { key: 'status', label: 'Status', max: 120 }, { key: 'link', label: 'Pipeline link', type: 'url', max: 600 },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
    { key: 'exclusions', label: 'Companies or people to exclude', type: 'textarea', max: 2500 },
  ] },
  { title: 'Partnerships & technology', fields: [
    { key: 'partnerships', label: 'Strategic and channel partnerships', add: 'Add partner', rows: [
      { key: 'company', label: 'Partner', max: 180 }, { key: 'relationship', label: 'Relationship', max: 200 },
      { key: 'link', label: 'Link', type: 'url', max: 600 }, { key: 'notes', label: 'Notes', max: 600 },
    ] },
    { key: 'current_integrations', label: 'Current integrations', type: 'textarea', max: 2500 },
    { key: 'desired_integrations', label: 'Desired integrations', type: 'textarea', max: 2500 },
  ] },
  { title: 'Goals & success', intro: 'What a good year together looks like.', fields: [
    { key: 'goals', label: 'What do you want from this partnership in the next 6–12 months?', type: 'textarea', max: 2500 },
    { key: 'intro_target', label: 'Target introductions per month', type: 'number' },
    { key: 'success_metrics', label: 'How will you measure success?', type: 'textarea', max: 2500 },
    { key: 'key_dates', label: 'Key dates', add: 'Add date', hint: 'Launches, trade shows and deadlines we should plan around.', rows: [
      { key: 'label', label: 'Event or milestone', max: 200 }, { key: 'date', label: 'Date', max: 80 },
      { key: 'notes', label: 'Notes', max: 600 },
    ] },
    { key: 'capacity', label: 'Who follows up on introductions, and how quickly?', max: 400 },
  ] },
  { title: 'Brand & content', intro: 'For posts, podcast mentions and anything else we publish about you.', fields: [
    { key: 'key_messages', label: 'Key messages', type: 'textarea', max: 2500 },
    { key: 'boilerplate', label: 'Approved company description', type: 'textarea', max: 2500 },
    { key: 'topics', label: 'Topics you can speak on', type: 'textarea', max: 2500 },
    { key: 'spokespeople', label: 'Spokespeople', add: 'Add spokesperson', rows: [
      { key: 'name', label: 'Name', max: 150 }, { key: 'title', label: 'Job title', max: 160 },
      { key: 'email', label: 'Email', type: 'email', max: 254 }, { key: 'topics', label: 'Topics', max: 400 },
    ] },
    { key: 'news', label: 'Upcoming news, launches or announcements', type: 'textarea', max: 2500 },
    { key: 'avoid', label: 'Claims, topics or wording to avoid', type: 'textarea', max: 2500 },
    { key: 'approvals', label: 'Who approves content that mentions you, and how fast?', max: 400 },
    { key: 'assets', label: 'Sales, marketing and media assets', add: 'Add link', hint: 'Decks, one-pagers, case studies, logos and video.', rows: [
      { key: 'label', label: 'Asset name', max: 150 }, { key: 'link', label: 'Asset link', type: 'url', max: 600 },
    ] },
    { key: 'linkedin', label: 'LinkedIn', type: 'url', max: 600 }, { key: 'x', label: 'X', type: 'url', max: 600 },
    { key: 'instagram', label: 'Instagram', type: 'url', max: 600 }, { key: 'youtube', label: 'YouTube', type: 'url', max: 600 },
  ] },
  { title: 'Team & logistics', intro: 'Last step. How we work together.', fields: [
    { key: 'team', label: 'Key team members', add: 'Add team member', rows: [
      { key: 'first_name', label: 'First name', max: 100 }, { key: 'last_name', label: 'Last name', max: 100 },
      { key: 'email', label: 'Email', type: 'email', max: 254 }, { key: 'title', label: 'Job title', max: 150 },
    ] },
    { key: 'intro_method', label: 'Preferred introduction method', type: 'select', options: ['Email introduction', 'Scheduled call', 'Either'] },
    { key: 'intro_cc', label: 'Who should be copied on introductions?', max: 400 },
    { key: 'scheduling_link', label: 'Scheduling link', type: 'url', max: 600 },
    { key: 'report_recipients', label: 'Who should receive the monthly report?', max: 400 },
    { key: 'anything_else', label: 'Anything else we should know?', type: 'textarea', max: 2500 },
  ] },
];

export const intakeFields = sections.flatMap(section => section.fields);

export const isAnswered = value => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';

// Share of form fields with an answer, 0–100.
export function completeness(answers = {}) {
  const filled = intakeFields.filter(field => isAnswered(answers[field.key])).length;
  return Math.round(filled / intakeFields.length * 100);
}
