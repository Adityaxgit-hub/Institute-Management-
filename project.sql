CREATE DATABASE institute;
USE institute;

-- USERS TABLE
CREATE TABLE Users(
  user_Id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(10)
);
-- -- DEPARTMENT TABLE
CREATE TABLE Department(
  dept_Id INT PRIMARY KEY AUTO_INCREMENT,
  dept_name VARCHAR(100) NOT NULL,
  HOD_Id INT
);

-- -- FACULTY TABLE
CREATE TABLE Faculty(
  faculty_Id INT PRIMARY KEY AUTO_INCREMENT,
  first_name VARCHAR(50),
  last_name VARCHAR(50),
  email VARCHAR(100) UNIQUE,
  phone VARCHAR(15) UNIQUE,
  designation VARCHAR(50),
  join_date DATE,
  dept_Id INT,
  user_Id INT,
  FOREIGN KEY (dept_Id) REFERENCES Department(dept_Id),
  FOREIGN KEY (user_Id) REFERENCES Users(user_Id)
);

ALTER TABLE Department
ADD FOREIGN KEY (HOD_Id) REFERENCES Faculty(faculty_Id);

-- -- COURSES TABLE
CREATE TABLE Courses(
  course_Id VARCHAR(10) PRIMARY KEY,
  course_name VARCHAR(100) NOT NULL,
  credits INT,
  dept_Id INT,
  FOREIGN KEY (dept_Id) REFERENCES Department(dept_Id)
);

-- -- STUDENTS TABLE
CREATE TABLE Students(
  student_Id VARCHAR(15) PRIMARY KEY,
  first_name VARCHAR(50),
  last_name VARCHAR(50),
  email VARCHAR(100) UNIQUE,
  phone VARCHAR(15) UNIQUE,
  DOB DATE,
  admission_date DATE,
  dept_Id INT,
  user_Id INT,
  FOREIGN KEY (dept_Id) REFERENCES Department(dept_Id),
  FOREIGN KEY (user_Id) REFERENCES Users(user_Id)
);

-- -- ENROLLMENTS TABLE
CREATE TABLE Enrollments(
  enroll_Id INT PRIMARY KEY AUTO_INCREMENT,
  student_Id VARCHAR(15),
  course_Id VARCHAR(10),
  semester INT,
  year INT,
  FOREIGN KEY (student_Id) REFERENCES Students(student_Id),
  FOREIGN KEY (course_Id) REFERENCES Courses(course_Id)
);

-- -- TEACHES TABLE
CREATE TABLE Teaches(
  teach_Id INT PRIMARY KEY AUTO_INCREMENT,
  faculty_Id INT,
  course_Id VARCHAR(10),
  semester INT,
  year INT,
  section CHAR(1),
  FOREIGN KEY (faculty_Id) REFERENCES Faculty(faculty_Id),
  FOREIGN KEY (course_Id) REFERENCES Courses(course_Id)
);

-- -- ATTENDANCE TABLE
CREATE TABLE Attendance(
  Attd_Id INT PRIMARY KEY AUTO_INCREMENT,
  student_Id VARCHAR(15),
  course_Id VARCHAR(10),
  Attd_Date DATE,
  Status CHAR(1),
  FOREIGN KEY (student_Id) REFERENCES Students(student_Id),
  FOREIGN KEY (course_Id) REFERENCES Courses(course_Id)
);

-- 🔹 Departments
INSERT INTO Department (dept_name) VALUES
('Computer Science'),
('Electrical Engineering'),
('Mechanical Engineering'),
('Civil Engineering'),
('Information Technology');

-- 🔹 Faculty Users
INSERT INTO Users (username, password, role) VALUES
('ravi.kumar', 'ravi123', 'faculty'),
('anita.sharma', 'anita123', 'faculty'),
('vikram.patel', 'vikram123', 'faculty'),
('neha.verma', 'neha123', 'faculty'),
('suresh.reddy', 'suresh123', 'faculty');

-- 🔹 Faculty Members
INSERT INTO Faculty (first_name, last_name, email, phone, designation, join_date, user_Id)
VALUES
('Ravi', 'Kumar', 'ravi.kumar@nitp.ac.in', '9000000001', 'Professor', '2015-07-12', 1),
('Anita', 'Sharma', 'anita.sharma@nitp.ac.in', '9000000002', 'Associate Professor', '2016-08-10', 2),
('Vikram', 'Patel', 'vikram.patel@nitp.ac.in', '9000000003', 'Assistant Professor', '2019-01-05', 3),
('Neha', 'Verma', 'neha.verma@nitp.ac.in', '9000000004', 'HOD', '2013-03-20', 4),
('Suresh', 'Reddy', 'suresh.reddy@nitp.ac.in', '9000000005', 'Professor', '2014-11-18', 5);

-- 🔹 Assign HODs
UPDATE Department SET HOD_Id = 4 WHERE dept_Id = 1;
UPDATE Department SET HOD_Id = 1 WHERE dept_Id = 2;
UPDATE Department SET HOD_Id = 2 WHERE dept_Id = 3;
UPDATE Department SET HOD_Id = 3 WHERE dept_Id = 4;
UPDATE Department SET HOD_Id = 5 WHERE dept_Id = 5;

-- 🔹 Courses
INSERT INTO Courses (course_Id, course_name, credits, dept_Id) VALUES
('CS101', 'Intro to Programming', 3, 1),
('CS102', 'Data Structures', 4, 1),
('EE101', 'Circuit Analysis', 3, 2),
('ME101', 'Thermodynamics', 3, 3),
('CE101', 'Surveying', 3, 4),
('IT101', 'Web Technologies', 3, 5);

-- 🔹 Student Users (first 10 only for brevity)
INSERT INTO Users (username, password, role) VALUES
('abhiinay', 'abhiinay123', 'student'),
('aditya', 'aditya123', 'student'),
('giridhar', 'giridhar123', 'student'),
('praveen', 'praveen123', 'student'),
('aardhya', 'aardhya123', 'student'),
('aditi', 'aditi123', 'student'),
('ananya', 'ananya123', 'student'),
('ishitha', 'ishitha123', 'student'),
('diya', 'diya123', 'student'),
('meera', 'meera123', 'student');

-- 🔹 Students
INSERT INTO Students (student_Id, first_name, last_name, email, phone, DOB, admission_date, dept_Id, user_Id)
VALUES
('S001', 'Abhiinay', 'Rao', 'abhiinay.rao@institute.edu', '8000000001', '2003-05-10', '2022-08-01', 1, 6),
('S002', 'Aditya', 'Sharma', 'aditya.sharma@institute.edu', '8000000002', '2003-02-15', '2022-08-01', 1, 7),
('S003', 'Giridhar', 'Patel', 'giridhar.patel@institute.edu', '8000000003', '2003-09-12', '2022-08-01', 2, 8),
('S004', 'Praveen', 'Reddy', 'praveen.reddy@institute.edu', '8000000004', '2003-04-23', '2022-08-01', 3, 9),
('S005', 'Aaradhya', 'Singh', 'aaradhya.singh@institute.edu', '8000000005', '2004-01-15', '2022-08-01', 1, 10),
('S006', 'Aditi', 'Verma', 'aditi.verma@institute.edu', '8000000006', '2004-02-20', '2022-08-01', 1, 11),
('S007', 'Ananya', 'Mishra', 'ananya.mishra@institute.edu', '8000000007', '2004-03-05', '2022-08-01', 2, 12),
('S008', 'Ishita', 'Patel', 'ishita.patel@institute.edu', '8000000008', '2004-04-10', '2022-08-01', 3, 13),
('S009', 'Diya', 'Sharma', 'diya.sharma@institute.edu', '8000000009', '2004-05-18', '2022-08-01', 4, 14),
('S010', 'Meera', 'Rao', 'meera.rao@institute.edu', '8000000010', '2004-06-11', '2022-08-01', 5, 15);

-- 🔹 Teaches (Faculty teaches Courses)
INSERT INTO Teaches (faculty_Id, course_Id, semester, year, section) VALUES
(1, 'CS101', 4, 2024, 'A'),
(1, 'CS102', 4, 2024, 'A'),
(2, 'EE101', 4, 2024, 'B'),
(3, 'ME101', 4, 2024, 'A'),
(4, 'CE101', 4, 2024, 'B'),
(5, 'IT101', 4, 2024, 'A');

-- 🔹 Enrollments
INSERT INTO Enrollments (student_Id, course_Id, semester, year) VALUES
('S001', 'CS101', 4, 2024),
('S002', 'CS101', 4, 2024),
('S005', 'CS102', 4, 2024),
('S006', 'CS102', 4, 2024),
('S003', 'EE101', 4, 2024),
('S007', 'EE101', 4, 2024),
('S004', 'ME101', 4, 2024),
('S008', 'ME101', 4, 2024),
('S009', 'CE101', 4, 2024),
('S010', 'IT101', 4, 2024);

-- 🔹 Attendance
INSERT INTO Attendance (student_Id, course_Id, Attd_Date, Status) VALUES
('S001', 'CS101', '2024-08-05', 'P'),
('S001', 'CS101', '2024-08-06', 'A'),
('S002', 'CS101', '2024-08-05', 'P'),
('S005', 'CS102', '2024-08-05', 'P'),
('S006', 'CS102', '2024-08-06', 'P'),
('S003', 'EE101', '2024-08-05', 'A'),
('S004', 'ME101', '2024-08-05', 'P'),
('S008', 'ME101', '2024-08-06', 'P'),
('S009', 'CE101', '2024-08-05', 'A'),
('S010', 'IT101', '2024-08-05', 'P');
 
-- Department-HOD table
CREATE VIEW dept_HOD_table AS
SELECT d.dept_Id,d.dept_name,d.HOD_Id,CONCAT(f.first_name," ",f.last_name) fullName
FROM Department d 
JOIN Faculty f ON (d.HOD_Id = f.faculty_id)
ORDER BY d.dept_Id;
 
-- SELECT * FROM dept_HOD_table;

-- faculty-department table
CREATE VIEW faculty_dept_table AS 
SELECT f.faculty_Id,CONCAT(f.first_name,' ',f.last_name) faculty_name,d.dept_Id,d.dept_name
FROM Faculty f
JOIN Department d ON (f.dept_Id = d.dept_Id)
ORDER BY f.faculty_id;

-- SELECT * FROM faculty_dapt_table;

-- student-department table
CREATE VIEW student_dept_table AS
SELECT s.student_Id,CONCAT(s.first_name," ",s.last_name) student_name,s.DOB,s.email,s.phone,d.dept_name
FROM Students s
JOIN Department d ON (s.dept_Id = d.dept_Id)
ORDER BY s.student_Id;

-- SELECT * FROM student_dept_table;

-- department-course table
CREATE VIEW courses_dept_table AS 
SELECT d.dept_Id,d.dept_name,c.course_Id,c.course_name
FROM department d
JOIN courses c ON (d.dept_Id = c.dept_Id);

-- SELECT * FROM courses_dept_table;

-- faculty-course table
CREATE VIEW faculty_course_table AS
SELECT t.faculty_Id,CONCAT(f.first_name," ",f.last_name) faculty_name,c.course_name,t.section,t.semester,t.year
FROM Teaches t
JOIN Faculty f ON (t.faculty_Id = f.faculty_Id)
JOIN Courses c ON (t.course_Id = c.course_Id)
ORDER BY t.faculty_Id;

-- SELECT * FROM faculty_course_table;

-- student-course table
CREATE VIEW student_course_table AS
SELECT e.student_Id,CONCAT(s.first_name," ",s.last_name) student_name,e.course_Id,c.course_name,e.semester,e.year
FROM Enrollments e
JOIN Students s ON (e.student_Id = s.student_Id)
JOIN Courses c ON (e.course_Id = c.course_Id)
ORDER BY e.student_Id;

-- SELECT * FROM student_course_table;

-- attendence details
CREATE VIEW attendance_report AS
SELECT a.attd_date,a.student_Id,CONCAT(s.first_name,' ',s.last_name) student_name,a.course_Id,
	CASE 
		WHEN a.status = 'P' THEN 'Present'
		WHEN a.status = 'A' THEN 'Abscent'
        ELSE ' '
	END att
FROM Attendance a
JOIN Students s ON (a.student_Id=s.student_Id)
ORDER BY a.attd_date,s.student_Id;

SELECT * FROM attendance_report;

-- user details table
CREATE VIEW user_info AS
SELECT user_Id,username,role
FROM Users
ORDER BY user_Id;

SELECT * FROM user_info;


INSERT INTO Users (username, password, role) VALUES
('admin', 'admin123', 'admin');