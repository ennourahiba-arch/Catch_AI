import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import StudentDashboard from "./pages/StudentDashboard";
import Practice from "./pages/Practice";
import Play from "./pages/Play";
import ProfessorDashboard from "./pages/ProfessorDashboard";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="student" element={<StudentDashboard />} />
        <Route path="practice/:topic" element={<Practice />} />
        <Route path="play/:roundId" element={<Play />} />
        <Route path="professor" element={<ProfessorDashboard />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
