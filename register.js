(() => {
  'use strict';
  const { api, me, homeFor, clearErrors, showFieldErrors, handleFormError, setBusy } = ER;

  const form = document.getElementById('register-form');
  const button = form.querySelector('button[type="submit"]');

  me().then((user) => { if (user) location.replace(homeFor(user)); }).catch(() => {});
  ER.watchForm(form);

  // Same rules as the server; the server is still the authority.
  function check({ name, email, password, confirmPassword }) {
    const errors = {};
    if (name.trim().length < 2) errors.name = 'Name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) errors.password = 'Password must contain at least one letter and one number.';
    if (!errors.password && confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);

    const els = form.elements;
    const values = {
      name: els.namedItem('name').value,
      email: els.namedItem('email').value,
      password: els.namedItem('password').value,
      confirmPassword: els.namedItem('confirmPassword').value,
    };
    const errors = check(values);
    if (Object.keys(errors).length) return showFieldErrors(form, errors);

    setBusy(button, true, 'Create account', 'Creating account...');
    try {
      await api.post('/api/auth/register', values);
      location.replace('index.html?registered=1');
    } catch (err) {
      handleFormError(form, err);
      setBusy(button, false, 'Create account', 'Creating account...');
    }
    return undefined;
  });
})();
