import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import Products from "./components/Products";
import HowItWorks from "./components/HowItWorks";
import Sense from "./components/Sense";
import Order from "./components/Order";
import Footer from "./components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Products />
        <HowItWorks />
        <Sense />
        <Order />
      </main>
      <Footer />
    </>
  );
}
