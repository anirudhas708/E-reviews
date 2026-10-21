(async () => {
  'use strict';
  const { api, requireUser, mountHeader, clearErrors, showFieldErrors, handleFormError, setBusy } = ER;

  const user = await requireUser('user');
  mountHeader(user, 'add-review.html');

  const form = document.getElementById('review-form');
  const confirmation = document.getElementById('confirmation');
  const button = form.querySelector('button[type="submit"]');
  const els = form.elements;
  const counter = document.getElementById('review-counter');
  const text = els.namedItem('review_text');
  const dateInput = els.namedItem('purchase_date');

  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function resetForm() {
    form.reset();
    clearErrors(form);
    els.namedItem('reviewer_name').value = user.name;
    dateInput.max = todayLocal();
    updateCounter();
  }

  function updateCounter() {
    const n = text.value.trim().length;
    counter.textContent = `${n} / 2000 (at least 20)`;
  }

  text.addEventListener('input', updateCounter);
  ER.watchForm(form);
  resetForm();

  document.getElementById('add-another').addEventListener('click', () => {
    confirmation.hidden = true;
    form.hidden = false;
    resetForm();
    els.namedItem('company_name').focus();
  });

  function check(values) {
    const errors = {};
    if (values.company_name.trim().length < 2) errors.company_name = 'Company name must be at least 2 characters.';
    if (values.product_purchased.trim().length < 2) errors.product_purchased = 'Product purchased must be at least 2 characters.';
    if (!values.purchase_date) errors.purchase_date = 'Date of purchase is required.';
    else if (values.purchase_date > todayLocal()) errors.purchase_date = 'Date of purchase cannot be in the future.';
    if (values.reviewer_name.trim().length < 2) errors.reviewer_name = 'Your name must be at least 2 characters.';
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(values.price.trim())) errors.price = 'Enter a valid price, for example 1299 or 1299.50.';
    if (!values.rating) errors.rating = 'Choose a rating from 1 to 5.';
    if (values.review_text.trim().length < 20) errors.review_text = 'Your review must be at least 20 characters.';
    return errors;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);

    const checked = form.querySelector('input[name="rating"]:checked');
    const values = {
      company_name: els.namedItem('company_name').value,
      product_purchased: els.namedItem('product_purchased').value,
      purchase_date: dateInput.value,
      reviewer_name: els.namedItem('reviewer_name').value,
      price: els.namedItem('price').value,
      currency: els.namedItem('currency').value,
      rating: checked ? Number(checked.value) : null,
      review_text: text.value,
    };

    const errors = check(values);
    if (Object.keys(errors).length) return showFieldErrors(form, errors);

    setBusy(button, true, 'Submit review', 'Submitting...');
    try {
      const { review } = await api.post('/api/reviews', values);
      document.getElementById('confirmation-text').textContent =
        `Thanks, ${review.reviewer_name}. Your ${review.rating}-star review of ${review.product_purchased} from ${review.company_name} was submitted.`;
      form.hidden = true;
      confirmation.hidden = false;
      confirmation.querySelector('h2').scrollIntoView({ block: 'center' });
    } catch (err) {
      if (err.status === 401) return location.replace('index.html');
      handleFormError(form, err);
    } finally {
      setBusy(button, false, 'Submit review', 'Submitting...');
    }
    return undefined;
  });
})();
