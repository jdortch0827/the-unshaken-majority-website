const menuButton = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');

if (menuButton && navLinks) {
  menuButton.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
}

const year = document.querySelector('[data-current-year]');
if (year) year.textContent = new Date().getFullYear();

const caseForm = document.querySelector('#case-form');
if (caseForm) {
  caseForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(caseForm);
    const subject = encodeURIComponent(`Case submission: ${data.get('title') || 'Untitled case'}`);
    const body = encodeURIComponent([
      `Name or alias: ${data.get('name') || 'Not provided'}`,
      `Reply email: ${data.get('email') || 'Not provided'}`,
      `Organization or issue: ${data.get('organization') || 'Not provided'}`,
      `Date observed: ${data.get('date') || 'Not provided'}`,
      '',
      'What happened:',
      data.get('summary') || 'Not provided',
      '',
      'Comparable case or different treatment:',
      data.get('comparison') || 'Not provided',
      '',
      'Source links:',
      data.get('sources') || 'Not provided',
      '',
      `Permission to contact: ${data.get('permission') || 'No selection'}`
    ].join('\n'));

    const mailto = `mailto:theunshakenmajority@gmail.com?subject=${subject}&body=${body}`;
    const status = document.querySelector('#form-status');
    if (status) {
      status.textContent = 'Your email app is opening with the submission filled in. Attach screenshots or documents before sending.';
    }
    window.location.href = mailto;
  });
}
