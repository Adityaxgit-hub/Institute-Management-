DROP DATABASE IF EXISTS institute;
CREATE DATABASE institute;
USE institute;

-- USERS TABLE
CREATE TABLE IF NOT EXISTS Users(
  user_Id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(10)
);

-- DEPARTMENT TABLE
CREATE TABLE IF NOT EXISTS Department(
  dept_Id INT PRIMARY KEY AUTO_INCREMENT,
  dept_name VARCHAR(100) NOT NULL,
  HOD_Id INT
);

-- FACULTY TABLE
CREATE TABLE IF NOT EXISTS Faculty(
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

-- COURSES TABLE
CREATE TABLE IF NOT EXISTS Courses(
  course_Id VARCHAR(10) PRIMARY KEY,
  course_name VARCHAR(100) NOT NULL,
  credits INT,
  dept_Id INT,
  FOREIGN KEY (dept_Id) REFERENCES Department(dept_Id)
);

-- STUDENTS TABLE
CREATE TABLE IF NOT EXISTS Students(
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

-- ENROLLMENTS TABLE
CREATE TABLE IF NOT EXISTS Enrollments(
  enroll_Id INT PRIMARY KEY AUTO_INCREMENT,
  student_Id VARCHAR(15),
  course_Id VARCHAR(10),
  semester INT,
  year INT,
  FOREIGN KEY (student_Id) REFERENCES Students(student_Id),
  FOREIGN KEY (course_Id) REFERENCES Courses(course_Id)
);

-- TEACHES TABLE
CREATE TABLE IF NOT EXISTS Teaches(
  teach_Id INT PRIMARY KEY AUTO_INCREMENT,
  faculty_Id INT,
  course_Id VARCHAR(10),
  semester INT,
  year INT,
  section CHAR(1),
  FOREIGN KEY (faculty_Id) REFERENCES Faculty(faculty_Id),
  FOREIGN KEY (course_Id) REFERENCES Courses(course_Id)
);

-- ATTENDANCE TABLE
CREATE TABLE IF NOT EXISTS Attendance(
  Attd_Id INT PRIMARY KEY AUTO_INCREMENT,
  student_Id VARCHAR(15),
  course_Id VARCHAR(10),
  Attd_Date DATE,
  Status CHAR(1),
  FOREIGN KEY (student_Id) REFERENCES Students(student_Id),
  FOREIGN KEY (course_Id) REFERENCES Courses(course_Id)
);

-- Departments
INSERT INTO Department (dept_name) VALUES
('Computer Science'),
('Electrical Engineering'),
('Mechanical Engineering'),
('Civil Engineering'),
('Information Technology');

-- Faculty Users
INSERT INTO Users (username, password, role) VALUES
('ravi.kumar', '$2b$10$ACQYbx1qCXf5vcGb.wcsGudkA3exa1GOqFjnCOkUlrpNtfGcGWuCW', 'faculty'),
('anita.sharma', '$2b$10$udsd3PEb7d7uqG3L2GB93On1DHxzoFG/433xrzet1FmDZNdfFf5ma', 'faculty'),
('vikram.patel', '$2b$10$3RwLArA9vAzQNyVsVpNZpegoJI3BszqOtzJpB2lolqkxpZH7a3iCm', 'faculty'),
('neha.verma', '$2b$10$NgKt7k9yJUfYFjh8FDEZzeDGMOuTBbBzTRKmj.bPbzLRUpR76gyWS', 'faculty'),
('suresh.reddy', '$2b$10$uToc.gYcAZSEgAHZngYemuG6bOq/atyRRtn7HxwZANschrNl1R9Dm', 'faculty');

-- Faculty Members
INSERT INTO Faculty (first_name, last_name, email, phone, designation, join_date, dept_Id, user_Id)
VALUES
('Ravi', 'Kumar', 'ravi.kumar@nitp.ac.in', '9000000001', 'Professor', '2015-07-12', 1, 1),
('Anita', 'Sharma', 'anita.sharma@nitp.ac.in', '9000000002', 'Associate Professor', '2016-08-10', 2, 2),
('Vikram', 'Patel', 'vikram.patel@nitp.ac.in', '9000000003', 'Assistant Professor', '2019-01-05', 3, 3),
('Neha', 'Verma', 'neha.verma@nitp.ac.in', '9000000004', 'HOD', '2013-03-20', 4, 4),
('Suresh', 'Reddy', 'suresh.reddy@nitp.ac.in', '9000000005', 'Professor', '2014-11-18', 5, 5);

-- Assign HODs
UPDATE Department SET HOD_Id = 4 WHERE dept_Id = 1;
UPDATE Department SET HOD_Id = 1 WHERE dept_Id = 2;
UPDATE Department SET HOD_Id = 2 WHERE dept_Id = 3;
UPDATE Department SET HOD_Id = 3 WHERE dept_Id = 4;
UPDATE Department SET HOD_Id = 5 WHERE dept_Id = 5;

-- Courses
INSERT INTO Courses (course_Id, course_name, credits, dept_Id) VALUES
('CS101', 'Intro to Programming', 3, 1),
('CS102', 'Data Structures', 4, 1),
('EE101', 'Circuit Analysis', 3, 2),
('ME101', 'Thermodynamics', 3, 3),
('CE101', 'Surveying', 3, 4),
('IT101', 'Web Technologies', 3, 5);

-- Student Users
INSERT INTO Users (username, password, role) VALUES
('abhiinay', '$2b$10$p/zl4NT.ClXasUr0zRnDtOv9qIStHkIK.nxhlHECLukGOY.0dZ2da', 'student'),
('aditya', '$2b$10$uo9pkLq8dG7mWys6XqqPSukwGfejJpesCxXoP1e6sAzQjY1AKFQYi', 'student'),
('giridhar', '$2b$10$2cdBvvaNdsmA/IKT1gMUI.ef4.yDfJHdNKUIs2UjkiuGm/DHW2aGa', 'student'),
('praveen', '$2b$10$KW8EoPUlAU3a1/0yaKxr3.J2elap8qRmrsHO10JFigTPVR7rJvagO', 'student'),
('aardhya', '$2b$10$qyvjYs0P6vrQKqTNtLhlteYcOvNhJitD37XiNAyy3i0Yfx2rHcssm', 'student'),
('aditi', '$2b$10$DySYEG/gf6XNnVaBTNOzT.miAQqCTQk/FytwxZNjWf46bxgqNqqf6', 'student'),
('ananya', '$2b$10$OZgeLdSE6nhNQ7OsAKgqpOMaU.Up71f9peyyt1uvtUVs3w5mALmYi', 'student'),
('ishitha', '$2b$10$G7Sbst5t0iGk8tzqLyOWRuAOq5bSNuNS/tTgyCydBOgoZ6.WqM7FS', 'student'),
('diya', '$2b$10$aeLlQYKy0dGTa2dobd9IFe7khQ6Ev5oB6hroMtUAotGX5HrdQlwse', 'student'),
('meera', '$2b$10$pGhhdikRiVwE.A9WvtwA5eFanr6eqd3nvJNqlqiJ4xlXHRSDN0YPC', 'student');

-- Students
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

-- Teaches
INSERT INTO Teaches (faculty_Id, course_Id, semester, year, section) VALUES
(1, 'CS101', 4, 2024, 'A'),
(1, 'CS102', 4, 2024, 'A'),
(2, 'EE101', 4, 2024, 'B'),
(3, 'ME101', 4, 2024, 'A'),
(4, 'CE101', 4, 2024, 'B'),
(5, 'IT101', 4, 2024, 'A');

-- Enrollments
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

-- Attendance
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

-- Department-HOD View
CREATE VIEW dept_HOD_table AS
SELECT d.dept_Id, d.dept_name, d.HOD_Id, CONCAT(f.first_name, ' ', f.last_name) AS fullName
FROM Department d 
JOIN Faculty f ON (d.HOD_Id = f.faculty_id)
ORDER BY d.dept_Id;

-- Faculty-Department View
CREATE VIEW faculty_dept_table AS 
SELECT f.faculty_Id, CONCAT(f.first_name, ' ', f.last_name) AS faculty_name, d.dept_Id, d.dept_name
FROM Faculty f
JOIN Department d ON (f.dept_Id = d.dept_Id)
ORDER BY f.faculty_id;

-- Student-Department View
CREATE VIEW student_dept_table AS
SELECT s.student_Id, CONCAT(s.first_name, ' ', s.last_name) AS student_name, s.DOB, s.email, s.phone, d.dept_name
FROM Students s
JOIN Department d ON (s.dept_Id = d.dept_Id)
ORDER BY s.student_Id;

-- Department-Course View
CREATE VIEW courses_dept_table AS 
SELECT d.dept_Id, d.dept_name, c.course_Id, c.course_name
FROM Department d
JOIN Courses c ON (d.dept_Id = c.dept_Id);

-- Faculty-Course View
CREATE VIEW faculty_course_table AS
SELECT t.faculty_Id, CONCAT(f.first_name, ' ', f.last_name) AS faculty_name, c.course_name, t.section, t.semester, t.year
FROM Teaches t
JOIN Faculty f ON (t.faculty_Id = f.faculty_Id)
JOIN Courses c ON (t.course_Id = c.course_Id)
ORDER BY t.faculty_Id;

-- Student-Course View
CREATE VIEW student_course_table AS
SELECT e.student_Id, CONCAT(s.first_name, ' ', s.last_name) AS student_name, e.course_Id, c.course_name, e.semester, e.year
FROM Enrollments e
JOIN Students s ON (e.student_Id = s.student_Id)
JOIN Courses c ON (e.course_Id = c.course_Id)
ORDER BY e.student_Id;

-- Attendance Report View
CREATE VIEW attendance_report AS
SELECT a.attd_date, a.student_Id, CONCAT(s.first_name, ' ', s.last_name) AS student_name, a.course_Id,
	CASE 
		WHEN a.status = 'P' THEN 'Present'
		WHEN a.status = 'A' THEN 'Absent'
        ELSE 'Absent'
	END AS att
FROM Attendance a
JOIN Students s ON (a.student_Id = s.student_Id)
ORDER BY a.attd_date, s.student_Id;

-- User Info View
CREATE VIEW user_info AS
SELECT user_Id, username, role
FROM Users
ORDER BY user_Id;

-- Additional Setup & Schema Adjustments
INSERT INTO Users (username, password, role) VALUES
('admin', '$2b$10$6n8PTVRZjji6mPhYhFCC0.ZNcreZo7SsmCUXCugVUM7v9HN1MAS1S', 'admin');

CREATE TABLE IF NOT EXISTS notifications(
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  target VARCHAR(10) DEFAULT 'all',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Faculty_Leave (
    leave_Id INT AUTO_INCREMENT PRIMARY KEY,
    faculty_Id INT NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
    applied_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faculty_Id) REFERENCES Faculty(faculty_Id)
);

UPDATE notifications SET target = 'student' WHERE target = 'students';

ALTER TABLE notifications 
ADD COLUMN pdf_url VARCHAR(500) NULL AFTER target;

ALTER TABLE notifications 
ADD COLUMN dept_Id INT NULL AFTER pdf_url;

CREATE TABLE IF NOT EXISTS notification_attachments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  notification_id INT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  FOREIGN KEY (notification_id) REFERENCES notifications(id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_Id INT NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_Id) REFERENCES Users(user_Id)
);

UPDATE Students 
SET first_name = 'abbhiinay' 
WHERE student_Id = 'S001';

DELETE FROM password_reset_tokens;

CREATE TABLE IF NOT EXISTS notification_reads (
  id INT PRIMARY KEY AUTO_INCREMENT,
  notification_id INT NOT NULL,
  user_Id INT NOT NULL,
  read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_read (notification_id, user_Id),
  FOREIGN KEY (notification_id) REFERENCES notifications(id),
  FOREIGN KEY (user_Id) REFERENCES Users(user_Id)
);

ALTER TABLE Attendance
ADD UNIQUE KEY uniq_attendance (student_Id, course_Id, Attd_Date);

ALTER TABLE Users
  ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN locked_until DATETIME NULL;
  
CREATE TABLE IF NOT EXISTS signup_otps (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(100) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL,
  record_id VARCHAR(15) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);  

ALTER TABLE Users
ADD COLUMN must_reset_password TINYINT(1) NOT NULL DEFAULT 1;

UPDATE Users SET must_reset_password = 1;

-- GRADING SYSTEM
CREATE TABLE IF NOT EXISTS Marks (
  mark_Id INT PRIMARY KEY AUTO_INCREMENT,
  student_Id VARCHAR(15) NOT NULL,
  course_Id VARCHAR(10) NOT NULL,
  semester INT NOT NULL,
  year INT NOT NULL,
  assignment1 DECIMAL(5,2) NULL,
  mid_exam DECIMAL(5,2) NULL,
  assignment2 DECIMAL(5,2) NULL,
  end_sem DECIMAL(5,2) NULL,
  internal_viva DECIMAL(5,2) NULL,
  external_viva DECIMAL(5,2) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (student_Id) REFERENCES Students(student_Id),
  FOREIGN KEY (course_Id) REFERENCES Courses(course_Id),
  FOREIGN KEY (updated_by) REFERENCES Faculty(faculty_Id),
  UNIQUE KEY uniq_marks (student_Id, course_Id, semester, year)
);

ALTER TABLE Students ADD UNIQUE KEY uniq_student_user (user_Id);
ALTER TABLE Faculty ADD UNIQUE KEY uniq_faculty_user (user_Id);

ALTER TABLE Department DROP FOREIGN KEY Department_ibfk_1;
ALTER TABLE Department ADD CONSTRAINT fk_department_hod FOREIGN KEY (HOD_Id) REFERENCES Faculty(faculty_Id) ON DELETE SET NULL;

ALTER TABLE notifications MODIFY COLUMN target VARCHAR(50) DEFAULT 'all';
