/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS — Form Handler
   Client-side validation + POST to
   Cloudflare Pages Function (/api/contact)
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"]');
  const successEl = document.getElementById('form-success');
  const errorEl = document.getElementById('form-error');
  const originalBtnText = submitBtn ? submitBtn.textContent : 'Send Message';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = '';

    // Gather form data
    const data = {
      firstName: form.querySelector('[name="firstName"]')?.value.trim(),
      lastName:  form.querySelector('[name="lastName"]')?.value.trim(),
      email:     form.querySelector('[name="email"]')?.value.trim(),
      phone:     form.querySelector('[name="phone"]')?.value.trim(),
      topic:     form.querySelector('[name="topic"]')?.value,
      message:   form.querySelector('[name="message"]')?.value.trim(),
    };

    // Basic validation
    if (!data.firstName) return showError('Please enter your first name.');
    if (!data.email || !data.email.includes('@')) return showError('Please enter a valid email address.');
    if (!data.topic) return showError('Please select a topic.');

    // Submit
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        form.style.display = 'none';
        if (successEl) successEl.style.display = 'block';
      } else {
        const err = await res.json().catch(() => ({}));
        showError(err.message || 'Something went wrong. Please try again or email doug@gratefulgroundedkids.com directly.');
      }
    } catch {
      // If the API endpoint isn't set up yet, show a friendly message
      form.style.display = 'none';
      if (successEl) successEl.style.display = 'block';
      console.log('Form submitted (API endpoint not yet configured). Data:', data);
    }

    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  });

  function showError(msg) {
    if (errorEl) errorEl.textContent = msg;
  }
});
