// Tests for the rule-based pack engine (pure functions, no database needed).
// Run with: node --test test/
import test from 'node:test'
import assert from 'node:assert/strict'
import { generatePack } from '../server/packEngine.js'

const baseQuote = {
  id: '11111111-2222-3333-4444-555555555555',
  publicReference: 'SH-11112222',
  projectType: 'Website',
  fullName: 'Test Client',
  email: 'client@example.com',
  phone: '+92 300 0000000',
  country: 'Pakistan',
  company: 'Acme',
  currency: 'USD',
  budgetRange: 'Under $150',
  details: 'I want a modern website for my bakery with a contact form and a photo gallery of my products.',
  contactConsent: true,
  formData: {},
  rawSubmission: { details: 'I want a modern website for my bakery with a contact form and a photo gallery of my products.' },
  createdAt: '2026-11-12T10:00:00.000Z',
}

const byType = (pack, type) => pack.artifacts.find((a) => a.type === type)

test('generates the full required artifact set with valid fields', () => {
  const pack = generatePack(baseQuote)
  const requiredTypes = [
    'original-submission', 'executive-summary', 'requirements-brief', 'requirements',
    'client-questions', 'solution-architecture', 'ux-plan', 'scope-of-work',
    'deliverables', 'estimate-internal', 'assumptions-and-exclusions',
    'production-plan', 'task-backlog', 'master-build-prompt', 'frontend-agent-prompt',
    'qa-agent-prompt', 'devops-agent-prompt', 'documentation-agent-prompt',
    'qa-test-plan', 'risk-review', 'release-checklist',
  ]
  for (const type of requiredTypes) {
    const artifact = byType(pack, type)
    assert.ok(artifact, `missing artifact: ${type}`)
    assert.equal(typeof artifact.title, 'string')
    assert.ok(artifact.title.length > 0)
    assert.equal(typeof artifact.content, 'string')
    assert.ok(artifact.content.length > 0)
    assert.ok(['markdown', 'json'].includes(artifact.format), `bad format for ${type}: ${artifact.format}`)
  }
})

test('detects category from the actual submission text', () => {
  assert.equal(generatePack({ ...baseQuote, details: 'I need an online store to sell handmade candles with cart and checkout' }).analysis.category, 'E-commerce store')
  assert.equal(generatePack({ ...baseQuote, projectType: 'Web app', details: 'A booking system for my clinic with login for staff' }).analysis.category, 'Web application')
  assert.equal(generatePack({ ...baseQuote, details: 'Company website with services pages' }).analysis.category, 'Website')
})

test('never fabricates: requirements.json lists only client sentences, inferred is empty', () => {
  const pack = generatePack(baseQuote)
  const structured = JSON.parse(byType(pack, 'requirements').content)
  assert.deepEqual(structured.inferred, [])
  for (const requirement of structured.explicit) {
    assert.ok(baseQuote.details.includes(requirement.source_excerpt), 'requirement not traceable to client text')
  }
})

test('original-submission is a faithful immutable JSON snapshot', () => {
  const pack = generatePack(baseQuote)
  const snapshot = JSON.parse(byType(pack, 'original-submission').content)
  assert.equal(snapshot.requestId, baseQuote.id)
  assert.equal(snapshot.publicReference, baseQuote.publicReference)
  assert.equal(snapshot.submission.details, baseQuote.details)
})

test('missing timeline triggers a clarification question instead of a fabricated date', () => {
  const pack = generatePack(baseQuote)
  const questions = byType(pack, 'client-questions').content
  assert.match(questions, /timeline/i)
  assert.ok(!/launch in \d+ weeks/i.test(questions), 'engine must not invent a timeline')
})

test('stated timeline is extracted, not invented', () => {
  const pack = generatePack({ ...baseQuote, details: `${baseQuote.details} I need it within 6 weeks.` })
  assert.equal(pack.analysis.timeline, 'within 6 weeks')
})

test('backend/database prompts apply to app categories and are omitted for plain websites', () => {
  const websitePack = generatePack(baseQuote)
  assert.ok(!byType(websitePack, 'backend-agent-prompt'), 'plain website should not get a backend prompt')
  assert.ok(!byType(websitePack, 'database-agent-prompt'))

  const appPack = generatePack({ ...baseQuote, details: 'Web app with user login and booking management' })
  assert.ok(byType(appPack, 'backend-agent-prompt'))
  assert.ok(byType(appPack, 'database-agent-prompt'))
})

test('integration prompt appears only when the submission mentions integrations', () => {
  const withPayment = generatePack({ ...baseQuote, details: 'Online store with payment checkout' })
  assert.ok(byType(withPayment, 'integration-agent-prompt'))

  const without = generatePack({ ...baseQuote, details: baseQuote.details })
  assert.ok(!byType(without, 'integration-agent-prompt'))
})

test('estimate marks pricing as admin-required and generates no price figures', () => {
  const estimate = byType(generatePack(baseQuote), 'estimate-internal').content
  assert.match(estimate, /Admin pricing required/)
  assert.ok(!/\$\s?\d{3,}/.test(estimate.replace(/Under \$150/g, '')), 'estimate must not compute a price')
  assert.match(estimate, /hours/, 'effort range should be present')
})

test('estimate is tagged internal-only', () => {
  const estimate = byType(generatePack(baseQuote), 'estimate-internal')
  assert.match(estimate.title, /ADMIN ONLY/)
  assert.match(estimate.content, /CONFIDENTIAL/)
})

test('master prompt carries the request reference, deliverables, and no-fabrication rules', () => {
  const master = byType(generatePack(baseQuote), 'master-build-prompt').content
  assert.match(master, /REQUEST ID: SH-11112222/)
  assert.match(master, /untrusted data/)
  assert.match(master, /contact form/, 'deliverables should reflect detected content')
})

test('generation is deterministic for the same submission', () => {
  const a = generatePack(baseQuote)
  const b = generatePack(baseQuote)
  assert.deepEqual(a.artifacts, b.artifacts)
})

test('risk review mentions personal-data exposure from collected contact fields', () => {
  const risk = byType(generatePack(baseQuote), 'risk-review').content
  assert.match(risk, /personal contact data/i)
  assert.match(risk, /untrusted data/i)
})
