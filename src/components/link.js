function Link(props = { text, to, icon, onClick }) {
  const handleClick = (e) => {
    if (props.onClick) {
      props.onClick(e);
    }
  };

  return (
    <a {...props} href={props.to} target='_blank' onClick={handleClick}>
      {props.icon && (
        <span className='material-symbols-outlined nav-icon'>{props.icon}</span>
      )}
      <span className='nav-label'>{props.text}</span>
    </a>
  );
}

export default Link;
