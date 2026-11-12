import React, { useEffect, useRef } from 'react'

const USD_TO_PKR = 276.951691
const EXCHANGE_RATE_AS_OF = 'Nov 11, 2026'
const pkrAmount = (usd) => `PKR ${new Intl.NumberFormat('en-US').format(Math.round((usd * USD_TO_PKR) / 1000) * 1000)}`

const budgetChoices = [
  { usd: 'Under $150', pkr: `Under ${pkrAmount(150)}` },
  { usd: '$250 - $500', pkr: `${pkrAmount(250)} - ${pkrAmount(500)}` },
  { usd: '$500 - $1,000', pkr: `${pkrAmount(500)} - ${pkrAmount(1000)}` },
  { usd: '$1,000 - $1,200', pkr: `${pkrAmount(1000)} - ${pkrAmount(1200)}` },
  { usd: '$1,200 - $2,000+', pkr: `${pkrAmount(1200)} - ${pkrAmount(2000)}+` },
  { usd: 'Not decided yet', pkr: 'Not decided yet' },
]

function installSiteEnhancements(frame) {
  const doc = frame.contentDocument
  if (!doc?.body || !doc.head) return () => {}

  let currency = 'USD'
  let selectedBudgetIndex = 0
  let budgetSelect
  let observer

  if (!doc.getElementById('shophippy-enhancements-style')) {
    const style = doc.createElement('style')
    style.id = 'shophippy-enhancements-style'
    style.textContent = `
      .shophippy-budget-field{position:relative}
      .shophippy-budget-field>label{display:flex;align-items:center;padding-right:112px}
      .shophippy-currency-mode{position:absolute;top:0;right:0;display:inline-flex;gap:3px;padding:3px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.04)}
      .shophippy-currency-mode button{border:0;border-radius:999px;padding:4px 9px;background:transparent;color:#9aa0b8;font:600 11px/1.3 Inter,system-ui,sans-serif}
      .shophippy-currency-mode button[aria-pressed="true"]{color:#fff;background:linear-gradient(110deg,#8b5cf6,#22d3ee)}
      .shophippy-currency-note{display:block;margin-top:6px;color:#8f96ad;font:400 10px/1.4 Inter,system-ui,sans-serif}
    `
    doc.head.appendChild(style)
  }

  const updateBudgetOptions = (select) => {
    const label = select.parentElement?.querySelector('label')
    if (label) {
      for (const node of label.childNodes) {
        if (node.nodeType === 3 && /Estimated budget/i.test(node.textContent)) {
          node.textContent = node.textContent.replace(/\s*\(USD\)/i, '')
        }
      }

      const field = select.parentElement
      field?.classList.add('shophippy-budget-field')
      let mode = field?.querySelector('.shophippy-currency-mode')
      if (!mode) {
        mode = doc.createElement('span')
        mode.className = 'shophippy-currency-mode'
        mode.setAttribute('role', 'group')
        mode.setAttribute('aria-label', 'Quote currency mode')
        for (const code of ['USD', 'PKR']) {
          const button = doc.createElement('button')
          button.type = 'button'
          button.textContent = code
          button.setAttribute('aria-pressed', String(currency === code))
          button.dataset.currency = code
          mode.appendChild(button)
        }
        label.after(mode)
      } else {
        for (const button of mode.querySelectorAll('button')) {
          button.setAttribute('aria-pressed', String(button.textContent === currency))
        }
      }

      let note = field?.querySelector('.shophippy-currency-note')
      if (field && !note) {
        note = doc.createElement('span')
        note.className = 'shophippy-currency-note'
        select.after(note)
      }
      if (note) {
        const message = `PKR ranges are approximate USD equivalents at PKR ${USD_TO_PKR.toFixed(2)} per USD (rate checked ${EXCHANGE_RATE_AS_OF}).`
        if (note.textContent !== message) note.textContent = message
      }
    }

    const optionLabels = budgetChoices.map((choice) => choice[currency.toLowerCase()])
    const desiredCount = optionLabels.length + 1
    while (select.options.length < desiredCount) {
      select.add(doc.createElement('option'))
    }
    while (select.options.length > desiredCount) {
      select.remove(select.options.length - 1)
    }
    if (select.options[0].value !== '') select.options[0].value = ''
    if (select.options[0].textContent !== 'Select a range...') {
      select.options[0].textContent = 'Select a range...'
    }
    optionLabels.forEach((text, index) => {
      const option = select.options[index + 1]
      const value = `${currency}: ${text}`
      if (option.textContent !== text) option.textContent = text
      if (option.value !== value) option.value = value
    })

    selectedBudgetIndex = Math.min(selectedBudgetIndex, select.options.length - 1)
    select.selectedIndex = selectedBudgetIndex
  }

  const updatePage = () => {
    const select = [...doc.querySelectorAll('select')].find((item) =>
      /Estimated budget/i.test(item.parentElement?.querySelector('label')?.textContent || ''),
    )
    if (select) {
      if (select !== budgetSelect) {
        budgetSelect = select
        budgetSelect.addEventListener('change', () => {
          selectedBudgetIndex = budgetSelect.selectedIndex
        })
      }
      updateBudgetOptions(select)
    }
  }

  let submittingQuote = false
  const handleQuoteSubmit = (event) => {
    const activeStep = doc.querySelector('.quote-body .fstep.active')
    const submitButton = [...(activeStep?.querySelectorAll('button') || [])]
      .find((button) => button.textContent.trim().startsWith('Submit Request'))
    const clickedButton = event.target instanceof doc.defaultView.Element
      ? event.target.closest('button')
      : null
    if (!submitButton || clickedButton !== submitButton) return
    if (submitButton.dataset.neonSaved === 'true') {
      delete submitButton.dataset.neonSaved
      return
    }
    if (submittingQuote) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    const form = doc.querySelector('.quote-body')
    const getField = (pattern) => [...(form?.querySelectorAll('.field') || [])]
      .find((field) => pattern.test(field.querySelector('label')?.textContent || ''))
    const valueFor = (pattern) => {
      const field = getField(pattern)
      const control = field?.querySelector('input:not([type=checkbox]), textarea, select')
      return control instanceof doc.defaultView.HTMLSelectElement
        ? control.options[control.selectedIndex]?.textContent.trim() || ''
        : control?.value.trim() || ''
    }
    const fullName = valueFor(/full name/i)
    const email = valueFor(/email/i)
    const phone = valueFor(/phone/i)
    const country = valueFor(/country/i)
    const details = valueFor(/details|describe|brief/i)
    const consent = [...(form?.querySelectorAll('.check-line') || [])]
      .find((label) => /agree to be contacted/i.test(label.textContent))
      ?.querySelector('input[type=checkbox]')?.checked === true

    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
      || !phone || !country || details.length < 15 || !consent) {
      return
    }

    const projectType = form.querySelector('input[name="projectType"]:checked')?.value || ''
    const budget = getField(/estimated budget/i)?.querySelector('select')
    const selectedCurrency = getField(/estimated budget/i)
      ?.querySelector('.shophippy-currency-mode button[aria-pressed="true"]')?.dataset.currency
    if (!projectType || !budget || budget.selectedIndex < 1 || !selectedCurrency) return

    const formData = {}
    for (const field of form.querySelectorAll('.field')) {
      const label = field.querySelector('label')?.textContent
        .replace(/\bUSD\b|\bPKR\b/g, '')
        .replace(/\*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const control = field.querySelector('input:not([type=checkbox]), textarea, select')
      if (!label || !control) continue
      if (control instanceof doc.defaultView.HTMLSelectElement) {
        const selected = control.options[control.selectedIndex]
        if (selected && control.selectedIndex > 0) formData[label] = selected.textContent.trim()
      } else if (control.value.trim()) {
        formData[label] = control.value.trim()
      }
    }
    formData['Requested features'] = [...form.querySelectorAll('.chip input:checked')]
      .map((input) => input.closest('.chip')?.textContent.trim())
      .filter(Boolean)
    formData['Design style'] = form.querySelector('input[name="style"]:checked')?.value || ''
    for (const label of form.querySelectorAll('.check-line')) {
      const title = label.textContent.replace(/\s+/g, ' ').replace(/\*/g, '').trim()
      const checkbox = label.querySelector('input[type=checkbox]')
      if (checkbox) formData[title] = checkbox.checked
    }

    const company = valueFor(/project\s*\/\s*company name/i)
    const status = doc.createElement('p')
    status.className = 'quote-submit-status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.style.cssText = 'margin:10px 0 0;color:#aeb5cc;font-size:13px;line-height:1.5'
    submitButton.parentElement?.appendChild(status)
    submitButton.disabled = true
    submittingQuote = true
    status.textContent = 'Saving your request securely...'

    const quote = {
      projectType,
      fullName,
      email,
      phone,
      country,
      company,
      currency: selectedCurrency,
      budgetRange: budget.options[budget.selectedIndex].textContent.trim(),
      details,
      contactConsent: consent,
      formData,
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    doc.defaultView.fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quote),
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to save the quote request.')
        return result
      })
      .then(() => {
        status.textContent = 'Your request was saved.'
        submitButton.disabled = false
        submittingQuote = false
        submitButton.dataset.neonSaved = 'true'
        submitButton.click()
      })
      .catch((error) => {
        console.error('Quote request could not be saved:', error)
        status.setAttribute('role', 'alert')
        status.style.color = '#fda4af'
        status.textContent = `${error.message} Your request has not been submitted. Please try again.`
        submitButton.disabled = false
        submittingQuote = false
      })
  }

  const handleCurrencyClick = (event) => {
    const button = event.target.closest('.shophippy-currency-mode button[data-currency]')
    if (!button || currency === button.dataset.currency) return

    const select = [...doc.querySelectorAll('select')].find((item) =>
      /Estimated budget/i.test(item.parentElement?.querySelector('label')?.textContent || ''),
    )
    if (!select) return

    selectedBudgetIndex = select.selectedIndex > 0 ? select.selectedIndex : selectedBudgetIndex
    currency = button.dataset.currency
    updateBudgetOptions(select)
    if (selectedBudgetIndex > 0) {
      select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
    }
  }

  doc.addEventListener('click', handleCurrencyClick)
  doc.addEventListener('click', handleQuoteSubmit, true)
  updatePage()
  observer = new doc.defaultView.MutationObserver(updatePage)
  observer.observe(doc.body, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  })

  return () => {
    observer?.disconnect()
    doc.removeEventListener('click', handleCurrencyClick)
    doc.removeEventListener('click', handleQuoteSubmit, true)
  }
}

export default function App() {
  const frameRef = useRef(null)
  const cleanupRef = useRef(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined

    const enhance = () => {
      cleanupRef.current?.()
      cleanupRef.current = installSiteEnhancements(frame)
    }
    frame.addEventListener('load', enhance)
    if (frame.contentDocument?.readyState === 'complete') enhance()

    return () => {
      frame.removeEventListener('load', enhance)
      cleanupRef.current?.()
    }
  }, [])

  return (
    <div className="app-shell">
      <iframe
        ref={frameRef}
        src="/static-build.html"
        title="Shophippy"
        className="site-frame"
      />
    </div>
  )
}
