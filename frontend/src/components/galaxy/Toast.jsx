export default function Toast({ message, show }) {
  return (
    <div className={`galaxy-toast ${show ? 'show' : ''}`}>
      {message}
    </div>
  );
}
