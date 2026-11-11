import { useI18n } from "../i18n.tsx";

/**
 * What Mission Control is for, at the top of the overview: in an empty
 * Organization and in a busy one alike, a person sees what they do here.
 */
export function Intro() {
  const { messages } = useI18n();
  return (
    <section className="intro">
      <p className="intro-lead">{messages.intro.lead}</p>
      <ul className="intro-items">
        {messages.intro.items.map((item) => (
          <li key={item.title} className="intro-item">
            <strong>{item.title}</strong>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
