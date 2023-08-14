import sgMail from '@sendgrid/mail';
import { ContactForm } from '../interfaces';

const { SENDGRID_API_KEY, RECEIVER_MAIL_ACC, SENDER_MAIL_ACC } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY ?? '');

export const handleSendMail = ({ name, message, contactType, contactInfo }: ContactForm) => {
  const emailData = {
    to: RECEIVER_MAIL_ACC ?? '',
    from: SENDER_MAIL_ACC ?? '',
    subject: `Pinta2: Contact from ${name}`,
    html: `<h1>Email from ${name}</h1>
           <p>Contact via: <strong>${contactType}</strong> => ${contactInfo}</p>
           <h3>Message:</h3>
           <p>${message}</p>
          `
  };
  return sgMail.send(emailData);
};
