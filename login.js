(() => {
  'use strict';
  const { api, me, homeFor, clearErrors, showNotice, handleFormError, setBusy } = ER;

  const form = document.getElementById('login-form');
  const button = form.querySelector('button[type="submit"]');

  // Already logged in? Go straight to the right page.
  me().then((user) => { if (user) location.replace(homeFor(user)); }).catch(() => {});

  ER.watchForm(form);

  if (new URLSearchParams(location.search).get('registered') === '1') {
    showNotice(form, 'Account created. Log in to continue.', 'ok');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);

    const email = form.email.value.trim();
    const password = form.password.value;
    const fields = {};
    if (!email) fields.email = 'Email is required.';
    if (!password) fields.password = 'Password is required.';
    if (Object.keys(fields).length) return ER.showFieldErrors(form, fields);

    setBusy(button, true, 'Log in', 'Logging in...');
    try {
      const { user } = await api.post('/api/auth/login', { email, password });
      location.replace(homeFor(user));
    } catch (err) {
      handleFormError(form, err);
      setBusy(button, false, 'Log in', 'Logging in...');
      if (err.code === 'INVALID_CREDENTIALS') form.password.value = '';
    }
    return undefined;
  });
})();
