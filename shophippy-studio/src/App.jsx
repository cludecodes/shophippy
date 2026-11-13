import React, { useEffect, useRef, useState } from 'react'
import './chatWidget.css'
import { createSaraEngine } from './chatEngine.js'

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

function ChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M5 18.5 3.8 21l4.4-1.6c1.15.42 2.4.65 3.8.65 5.52 0 10-3.8 10-8.5S17.52 3 12 3 2 6.8 2 11.5c0 2.8 1.17 5.1 3 7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7.5 11.5h.01m4.49 0h.01m4.49 0h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function ChatWidget({ isOpen, onOpenChange, onStartQuote }) {
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [messages, setMessages] = useState([
    {
      id: 1,
      from: 'sara',
      text: "Hi! I'm Sara, Shophippy's virtual project guide. Ask me about services, timelines, budgets — or tell me what you're building.",
    },
  ])
  const endOfMessagesRef = useRef(null)
  const replyEngine = useRef(createSaraEngine())
  const typingTimerRef = useRef(null)

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, typing, isOpen])

  useEffect(() => () => clearTimeout(typingTimerRef.current), [])

  const sendMessage = (message) => {
    const text = message.trim()
    if (!text || typing) return

    setMessages((current) => [
      ...current,
      { id: Date.now(), from: 'visitor', text },
    ])
    setDraft('')

    // Human-feel pacing: Sara "types" for a moment that scales with her answer.
    const reply = replyEngine.current(text)
    const delay = Math.min(2200, 650 + reply.length * 9)
    setTyping(true)
    clearTimeout(typingTimerRef.current)
    typingTimerRef.current = window.setTimeout(() => {
      setTyping(false)
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, from: 'sara', text: reply },
      ])
    }, delay)
  }

  return (
    <div className="sara-chat">
      {isOpen && (
        <section className="sara-panel" aria-label="Chat with Sara">
          <header className="sara-header">
            <div className="sara-avatar" aria-hidden="true">S</div>
            <div className="sara-heading">
              <strong>Sara</strong>
              <span>Shophippy virtual project guide</span>
            </div>
            <button
              className="sara-close"
              type="button"
              aria-label="Close chat"
              onClick={() => onOpenChange(false)}
            >
              ×
            </button>
          </header>

          <div className="sara-disclosure">
            Virtual assistant · Messages stay in this browser
          </div>

          <div className="sara-messages" role="log" aria-live="polite" aria-relevant="additions">
            {messages.map((message) => (
              <div
                className={`sara-message sara-message-${message.from}`}
                key={message.id}
              >
                {message.text}
              </div>
            ))}
            {typing && (
              <div className="sara-message sara-message-sara sara-typing" aria-label="Sara is typing">
                <i /><i /><i />
              </div>
            )}
            {messages.length === 1 && !typing && (
              <div className="sara-suggestions" aria-label="Suggested questions">
                {['What services do you offer?', 'How does the process work?', 'How do I get a quote?'].map((prompt) => (
                  <button type="button" key={prompt} onClick={() => sendMessage(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            )}
            <div ref={endOfMessagesRef} />
          </div>

          <form
            className="sara-compose"
            onSubmit={(event) => {
              event.preventDefault()
              sendMessage(draft)
            }}
          >
            <input
              aria-label="Message Sara"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask Sara a question..."
            />
            <button type="submit" aria-label="Send message" disabled={!draft.trim() || typing}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="m4 12 16-8-5.8 16-2.8-6.2L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="m11.4 13.8 4.2-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </form>

          <button className="sara-quote-link" type="button" onClick={onStartQuote}>
            Start a free quote <span aria-hidden="true">→</span>
          </button>
        </section>
      )}
      <button
        className="sara-launcher"
        type="button"
        aria-label={isOpen ? 'Close chat with Sara' : 'Chat with Sara'}
        aria-expanded={isOpen}
        onClick={() => onOpenChange((open) => !open)}
      >
        {isOpen ? <span className="sara-launcher-close">×</span> : <ChatIcon />}
        <span className="sara-launcher-label">Chat with Sara</span>
      </button>
    </div>
  )
}

function updateChatPlacement(frame) {
  const chat = document.querySelector('.sara-chat')
  const launcher = chat?.querySelector('.sara-launcher')
  const quoteContinue = [...(frame.contentDocument?.querySelectorAll('.page.active button') || [])]
    .find((button) => button.textContent.trim().startsWith('Continue'))
  if (!chat || !launcher || !quoteContinue) {
    chat?.style.removeProperty('right')
    return
  }

  const buttonRect = quoteContinue.getBoundingClientRect()
  const launcherRect = launcher.getBoundingClientRect()
  const overlaps = launcherRect.left < buttonRect.right
    && launcherRect.right > buttonRect.left
    && launcherRect.top < buttonRect.bottom
    && launcherRect.bottom > buttonRect.top

  if (overlaps) {
    chat.style.right = `${Math.max(12, window.innerWidth - buttonRect.left + 12)}px`
  } else {
    chat.style.removeProperty('right')
  }
}

function installSiteEnhancements(frame, openChat, updateChatPlacement) {
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
      .shophippy-chat-cta{display:inline-flex;align-items:center;gap:7px;padding:0;border:0;background:transparent;color:#b9a2ff;font:600 14px/1.6 Inter,system-ui,sans-serif}
      .shophippy-chat-cta svg{width:16px;height:16px}
      .shophippy-chat-cta:hover{color:#fff}
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
      if (field && !field.classList.contains('shophippy-budget-field')) {
        field.classList.add('shophippy-budget-field')
      }
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

    const footer = doc.querySelector('footer')
    const contactColumn = [...(footer?.querySelectorAll('.foot-col') || [])].find((column) =>
      [...column.querySelectorAll('h5')].some((heading) => heading.textContent.trim() === 'Get in touch'),
    )
    const contactList = contactColumn?.querySelector('ul')
    if (contactList) {
      for (const item of [...contactList.querySelectorAll('li')]) {
        if (/@|\+92|Karachi,\s*Pakistan/i.test(item.textContent)) item.remove()
      }
      if (!contactList.querySelector('[data-sara-footer-chat]')) {
        const item = doc.createElement('li')
        const button = doc.createElement('button')
        button.type = 'button'
        button.className = 'shophippy-chat-cta'
        button.dataset.saraFooterChat = 'true'
        const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
        icon.setAttribute('viewBox', '0 0 24 24')
        icon.setAttribute('fill', 'none')
        icon.setAttribute('aria-hidden', 'true')
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', 'M5 18.5 3.8 21l4.4-1.6c1.15.42 2.4.65 3.8.65 5.52 0 10-3.8 10-8.5S17.52 3 12 3 2 6.8 2 11.5c0 2.8 1.17 5.1 3 7Z')
        path.setAttribute('stroke', 'currentColor')
        path.setAttribute('stroke-width', '1.8')
        path.setAttribute('stroke-linejoin', 'round')
        icon.appendChild(path)
        button.append(icon, doc.createTextNode('Chat with Sara'))
        button.addEventListener('click', openChat)
        item.appendChild(button)
        contactList.prepend(item)
      }
    }
    updateChatPlacement()
  }

  let submittingQuote = false
  const handleQuoteSubmit = (event) => {
    // The submit button lives in the form's .form-nav bar, NOT inside the
    // active .fstep (steps contain no buttons), so search the whole form.
    const quoteBody = doc.querySelector('.quote-body')
    const submitButton = [...(quoteBody?.querySelectorAll('button') || [])]
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
    const showSaveError = () => {
      event.preventDefault()
      event.stopImmediatePropagation()
      // The submit button lives in .form-nav, outside the .fstep steps.
      const submitBtn = [...(form?.querySelectorAll('button') || [])]
        .find((button) => button.textContent.trim().startsWith('Submit Request'))
      if (submitBtn) {
        let status = form?.querySelector('.quote-submit-status')
        if (!status) {
          status = doc.createElement('p')
          status.className = 'quote-submit-status'
          status.setAttribute('role', 'alert')
          status.setAttribute('aria-live', 'assertive')
          status.style.cssText = 'margin:10px 0 0;color:#fda4af;font-size:13px;line-height:1.5'
          form?.appendChild(status)
        }
        status.textContent = 'Some required fields could not be read, so your request was NOT saved. Please complete every required field (including the project description and contact consent) and submit again. If this keeps happening, email us directly.'
      }
    }
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
    const details = valueFor(/tell us more|project details|details|describe|brief/i)
    const consent = [...(form?.querySelectorAll('.check-line') || [])]
      .find((label) => /agree to be contacted/i.test(label.textContent))
      ?.querySelector('input[type=checkbox]')?.checked === true

    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
      || !phone || !country || details.length < 15 || !consent) {
      // Never let a failed save look like success: the static form has its own
      // decorative "Your request is on its way!" screen. If we cannot extract
      // a complete payload, block the native submit and tell the user clearly.
      showSaveError()
      return
    }

    const projectType = form.querySelector('input[name="projectType"]:checked')?.value || ''
    const budget = getField(/estimated budget/i)?.querySelector('select')
    const selectedCurrency = getField(/estimated budget/i)
      ?.querySelector('.shophippy-currency-mode button[aria-pressed="true"]')?.dataset.currency
    if (!projectType || !budget || budget.selectedIndex < 1 || !selectedCurrency) {
      showSaveError()
      return
    }

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
    form?.appendChild(status)
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

  const refreshChatPlacement = () => updateChatPlacement()
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
  doc.addEventListener('scroll', refreshChatPlacement, true)
  window.addEventListener('resize', refreshChatPlacement)
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
    doc.removeEventListener('scroll', refreshChatPlacement, true)
    window.removeEventListener('resize', refreshChatPlacement)
  }
}

export default function App() {
  const frameRef = useRef(null)
  const cleanupRef = useRef(null)
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined

    const enhance = () => {
      cleanupRef.current?.()
      cleanupRef.current = installSiteEnhancements(
        frame,
        () => setChatOpen(true),
        () => updateChatPlacement(frame),
      )
    }
    frame.addEventListener('load', enhance)
    if (frame.contentDocument?.readyState === 'complete') enhance()

    return () => {
      frame.removeEventListener('load', enhance)
      cleanupRef.current?.()
    }
  }, [])

  const startQuote = () => {
    const doc = frameRef.current?.contentDocument
    const quoteButton = [...(doc?.querySelectorAll('button, a') || [])].find((element) =>
      /get a free quote|get a quote/i.test(element.textContent.trim()),
    )
    if (quoteButton) {
      quoteButton.click()
    } else if (frameRef.current?.contentWindow) {
      frameRef.current.contentWindow.location.hash = '#/quote'
    }
    setChatOpen(false)
  }

  return (
    <div className="app-shell">
      <iframe
        ref={frameRef}
        src="/static-build.html"
        title="Shophippy"
        className="site-frame"
      />
      <ChatWidget
        isOpen={chatOpen}
        onOpenChange={setChatOpen}
        onStartQuote={startQuote}
      />
    </div>
  )
}
